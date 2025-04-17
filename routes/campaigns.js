import fastifyMultipart from "@fastify/multipart";
import { parse } from "csv-parse/sync";
import sequelize from "../config/sequelize.js";
import Call from "../models/call.js";
import Campaign from "../models/campaign.js";
import Contact from "../models/Contact.js"; // Fixed import path
import db from "../models/index.js";
import {
  processCampaignBatch,
  recycleCampaign,
  restartCampaign,
} from "../services/campaign.js";

export default async function campaignRoutes(fastify, options) {
  // Register multipart plugin
  fastify.register(fastifyMultipart, {
    limits: {
      fieldSize: 1024 * 1024 * 10, // 10MB max file size
    },
  });

  // Create a new campaign
  fastify.post("/", async (request, reply) => {
    try {
      const {
        name,
        numbers,
        telnyx_numbers,
        system_message,
        first_message,
        ai_provider,
        user_id,
      } = request.body;

      if (!user_id) {
        return reply.code(400).send({ error: "User ID is required" });
      }

      // Format phone numbers by adding "+" if not present
      const formattedNumbers = numbers.map((number) =>
        number.startsWith("+") ? number : "+" + number
      );

      // Create campaign with all initial numbers
      const campaign = await Campaign.create({
        name,
        all_numbers: formattedNumbers,
        numbers_to_call: formattedNumbers, // Initially, all numbers need to be called
        telnyx_numbers,
        system_message,
        first_message,
        ai_provider,
        status: "pending",
        total_calls: formattedNumbers.length,
        user_id, // Add user_id
      });

      return campaign;
    } catch (error) {
      console.error("Error creating campaign:", error);
      reply.code(500).send({
        error: "Failed to create campaign",
        details: error.message,
      });
    }
  });

  // Get all campaigns with pagination
  fastify.get("/", async (request, reply) => {
    try {
      const page = parseInt(request.query.page) || 1;
      const limit = parseInt(request.query.limit) || 10;
      const offset = (page - 1) * limit;
      const user_id = request.query.user_id;

      if (!user_id) {
        return reply.code(400).send({ error: "User ID is required" });
      }

      const { count, rows } = await Campaign.findAndCountAll({
        where: { user_id },
        order: [["createdAt", "DESC"]],
        limit,
        offset,
      });

      // Format campaigns to match the desired structure
      const formattedCampaigns = rows.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        total_calls: campaign.total_calls,
        completed_calls: campaign.completed_calls,
        failed_calls: campaign.failed_calls,
        numbers_to_call: campaign.numbers_to_call,
        telnyx_numbers: campaign.telnyx_numbers,
        system_message: campaign.system_message,
        user_id: campaign.user_id,
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
      }));

      return {
        campaigns: formattedCampaigns,
        total: count,
        page: page,
        totalPages: Math.ceil(count / limit),
      };
    } catch (error) {
      console.error("Error listing campaigns:", error);
      reply.code(500).send({
        error: "Failed to list campaigns",
        details: error.message,
      });
    }
  });

  // Start a campaign
  fastify.post("/:id/start", async (request, reply) => {
    console.log("🚀 ~ fastify.post ~ request:", request.body);
    try {
      const campaign = await Campaign.findByPk(request.params.id);
      if (!campaign) {
        return reply.code(404).send({ error: "Campaign not found" });
      }

      if (campaign.status === "in_progress") {
        return reply.code(400).send({ error: "Campaign already in progress" });
      }

      // Update campaign status
      campaign.status = "in_progress";
      await campaign.save();

      // Start processing calls in batches
      processCampaignBatch(campaign);

      return { message: "Campaign started successfully" };
    } catch (error) {
      console.error("Error starting campaign:", error);
      reply.code(500).send({
        error: "Failed to start campaign",
        details: error.message,
      });
    }
  });

  // Get single campaign
  fastify.get("/:id", async (request, reply) => {
    try {
      const user_id = request.query.user_id;

      if (!user_id) {
        return reply.code(400).send({ error: "User ID is required" });
      }

      const campaign = await Campaign.findOne({
        where: {
          id: request.params.id,
          user_id: user_id,
        },
      });

      if (!campaign) {
        return reply
          .code(404)
          .send({ error: "Campaign not found or unauthorized access" });
      }

      // Format campaign to match desired structure
      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        total_calls: campaign.total_calls,
        completed_calls: campaign.completed_calls,
        failed_calls: campaign.failed_calls,
        numbers_to_call: campaign.numbers_to_call,
        telnyx_numbers: campaign.telnyx_numbers,
        system_message: campaign.system_message,
        user_id: campaign.user_id,
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
        voice: campaign.voice,
        voice_id: campaign.voice_id,
        language: campaign.language,
        ai_provider: campaign.ai_provider,
      };
    } catch (error) {
      console.error("Error fetching campaign:", error);
      reply.code(500).send({
        error: "Failed to fetch campaign",
        details: error.message,
      });
    }
  });

  // Pause campaign
  fastify.post("/:id/pause", async (request, reply) => {
    try {
      const campaign = await Campaign.findByPk(request.params.id);
      if (!campaign) {
        return reply.code(404).send({ error: "Campaign not found" });
      }

      if (campaign.status !== "in_progress") {
        return reply.code(400).send({ error: "Campaign is not in progress" });
      }

      // Move in-progress numbers back to numbers_to_call to ensure they're called when restarted
      const inProgressNumbers = campaign.in_progress_numbers || [];
      let updatedNumbersToCall = campaign.numbers_to_call || [];

      // Add any in-progress numbers back to numbers_to_call if they're not already there
      inProgressNumbers.forEach((number) => {
        if (!updatedNumbersToCall.includes(number)) {
          updatedNumbersToCall.push(number);
        }
      });

      // Store the current status before pausing and update other fields
      await campaign.update({
        last_status: campaign.status,
        status: "paused",
        numbers_to_call: updatedNumbersToCall,
        in_progress_numbers: [], // Clear in-progress numbers when pausing
      });

      return { success: true, message: "Campaign paused successfully" };
    } catch (error) {
      console.error("Error pausing campaign:", error);
      reply.code(500).send({ error: "Failed to pause campaign" });
    }
  });

  // Restart a campaign
  fastify.post("/:id/restart", async (request, reply) => {
    try {
      const campaign = await Campaign.findByPk(request.params.id);
      if (!campaign) {
        return reply.code(404).send({ error: "Campaign not found" });
      }

      await restartCampaign(campaign);
      reply.send({ message: "Campaign restarted successfully" });
    } catch (error) {
      console.error("Error restarting campaign:", error);
      reply.code(500).send({ error: "Failed to restart campaign" });
    }
  });

  // Recycle failed/unanswered calls in a campaign
  fastify.post("/:id/recycle", async (request, reply) => {
    try {
      const campaign = await Campaign.findByPk(request.params.id);
      if (!campaign) {
        return reply.code(404).send({ error: "Campaign not found" });
      }

      await recycleCampaign(campaign);
      reply.send({ message: "Campaign recycled successfully" });
    } catch (error) {
      console.error("Error recycling campaign:", error);
      reply.code(500).send({ error: "Failed to recycle campaign" });
    }
  });

  // Recycle unresponsive numbers
  fastify.post("/:id/recycle-unresponsive", async (request, reply) => {
    try {
      const campaign = await Campaign.findByPk(request.params.id);
      if (!campaign) {
        return reply.code(404).send({ error: "Campaign not found" });
      }

      // Use the recycleCampaign function which handles recycling of failed numbers
      await recycleCampaign(campaign);

      return {
        success: true,
        message: "Failed, no-answer, and busy numbers recycled successfully",
      };
    } catch (error) {
      console.error("Error recycling unresponsive numbers:", error);
      reply.code(500).send({ error: "Failed to recycle unresponsive numbers" });
    }
  });

  // Get campaign statistics with call logs
  fastify.get("/:id/stats", async (request, reply) => {
    try {
      const campaign = await db.Campaign.findByPk(request.params.id);

      if (!campaign) {
        return reply.code(404).send({ error: "Campaign not found" });
      }

      // Get pagination parameters
      const page = parseInt(request.query.page) || 1;
      const limit = parseInt(request.query.limit) || 10;
      const offset = (page - 1) * limit;

      // Get sorting parameters
      const sortField = request.query.sort_by || "start_time";
      const sortOrder =
        request.query.sort_order?.toUpperCase() === "ASC" ? "ASC" : "DESC";

      // Get filter parameters
      const statusFilter = request.query.status;
      const startDate = request.query.start_date;
      const endDate = request.query.end_date;

      // Build where clause for call logs
      const whereClause = {
        campaign_id: campaign.id,
      };

      if (statusFilter) {
        whereClause.status = statusFilter;
      }

      if (startDate || endDate) {
        whereClause.start_time = {};
        if (startDate) {
          whereClause.start_time[sequelize.Op.gte] = new Date(startDate);
        }
        if (endDate) {
          whereClause.start_time[sequelize.Op.lte] = new Date(endDate);
        }
      }

      // Get call logs for this campaign
      const { count, rows: callLogs } = await db.Call.findAndCountAll({
        where: whereClause,
        order: [[sortField, sortOrder]],
        limit,
        offset,
        attributes: [
          "call_sid",
          "from_number",
          "to_number",
          "status",
          "start_time",
          "end_time",
          "duration",
          "cost",
          "recording_url",
          "contact_id",
        ],
        include: [
          {
            model: db.Contact,
            as: "contact",
            attributes: ["firstName", "lastName", "gender"],
            required: false,
          },
        ],
      });

      const totalCalls = campaign.completed_calls + campaign.failed_calls;
      const completedCalls = campaign.completed_calls;
      const failedCalls = campaign.failed_calls;
      const progress =
        totalCalls > 0
          ? Math.round(((completedCalls + failedCalls) / totalCalls) * 100)
          : 0;
      const currentBatchProgress =
        campaign.current_batch_size > 0
          ? Math.round(
              (campaign.current_batch_completed / campaign.current_batch_size) *
                100
            )
          : 0;

      async function getCampaignStats(campaignId) {
        try {
          const campaign = await Campaign.findByPk(campaignId);
          if (!campaign) {
            throw new Error("Campaign not found");
          }

          // Get all calls for this campaign
          const calls = await Call.findAll({
            where: { campaign_id: campaignId },
            order: [["start_time", "DESC"]], // Get the most recent call first
          });

          // Group calls by phone number to find the latest status for each number
          const callsByNumber = {};
          calls.forEach((call) => {
            // If we haven't seen this number yet, it's the most recent call (because of our order)
            if (!callsByNumber[call.to_number]) {
              callsByNumber[call.to_number] = call;
            }
          });

          // Get unique numbers that have been called
          const uniqueNumbers = Object.keys(callsByNumber);

          // Calculate statuses based on the most recent call for each number
          const completedNumbers = [];
          const failedNumbers = [];

          uniqueNumbers.forEach((number) => {
            const latestCall = callsByNumber[number];
            if (latestCall.status === "completed") {
              completedNumbers.push(number);
            } else if (
              ["failed", "no-answer", "busy"].includes(latestCall.status)
            ) {
              failedNumbers.push(number);
            }
          });

          const stats = {
            // Total is based on initial numbers in campaign
            total_numbers: campaign.all_numbers.length,
            // Completed and failed counts based on most recent status
            completed_numbers: completedNumbers.length,
            failed_numbers: failedNumbers.length,
            // Numbers not yet called or in progress
            remaining_numbers: campaign.numbers_to_call.length,
            // Recyclable numbers (failed, no-answer, busy)
            recyclable_numbers: failedNumbers,
            // Progress percentage
            progress: (
              ((campaign.all_numbers.length - campaign.numbers_to_call.length) /
                campaign.all_numbers.length) *
              100
            ).toFixed(1),
            // Call attempt details
            call_attempts: {
              total_attempts: calls.length,
              completed_attempts: calls.filter(
                (call) => call.status === "completed"
              ).length,
              failed_attempts: calls.filter((call) =>
                ["failed", "no-answer", "busy"].includes(call.status)
              ).length,
            },
            // Cost and duration totals
            total_duration: calls.reduce(
              (sum, call) => sum + (call.duration || 0),
              0
            ),
            total_cost: calls
              .reduce((sum, call) => {
                const cost = parseFloat(call.cost || 0);
                return sum + cost;
              }, 0)
              .toFixed(4),
          };

          return stats;
        } catch (error) {
          console.error("Error getting campaign stats:", error);
          throw error;
        }
      }

      const campaignStats = await getCampaignStats(campaign.id);

      // Calculate button states based on campaign status and available recyclable numbers
      const buttonStates = {
        start: {
          enabled: campaign.status === "pending",
          tooltip:
            campaign.status === "in_progress"
              ? "Campaign is already running"
              : campaign.status === "paused"
              ? "Use Restart to continue the campaign"
              : campaign.status === "completed"
              ? "Campaign is completed. Create a new campaign to start again"
              : "Start the campaign",
        },
        pause: {
          enabled: campaign.status === "in_progress",
          tooltip:
            campaign.status === "paused"
              ? "Campaign is already paused"
              : campaign.status === "completed"
              ? "Campaign is completed"
              : campaign.status === "pending"
              ? "Start the campaign first"
              : "Pause the campaign",
        },
        restart: {
          enabled: campaign.status === "paused",
          tooltip:
            campaign.status === "in_progress"
              ? "Campaign is already running"
              : campaign.status === "paused"
              ? "Resume the campaign"
              : campaign.status === "completed"
              ? "Campaign is completed. Cannot restart"
              : "Campaign must be paused to restart",
        },
        recycle: {
          enabled:
            campaignStats.recyclable_numbers?.length > 0 &&
            (campaign.status === "completed" || campaign.status === "paused"),
          tooltip: !campaignStats.recyclable_numbers?.length
            ? "No failed calls to recycle"
            : campaign.status === "in_progress"
            ? "Pause campaign before recycling"
            : `Recycle ${campaignStats.recyclable_numbers.length} failed, no-answer, and busy numbers`,
        },
      };

      return {
        success: true,
        data: {
          total_calls: totalCalls,
          completed_calls: completedCalls,
          failed_calls: failedCalls,
          progress,
          current_batch: {
            size: campaign.current_batch_size,
            completed: campaign.current_batch_completed,
            progress: currentBatchProgress,
            numbers: campaign.numbers_in_current_batch,
          },
          remaining_calls: campaign.numbers_to_call.length,
          status: campaign.status,
          recyclable_numbers: campaignStats.recyclable_numbers || [],
          button_states: buttonStates,
          call_logs: {
            data: callLogs.map((call) => ({
              call_sid: call.call_sid,
              from: call.from_number,
              to: call.to_number,
              status: call.status,
              start_time: call.start_time,
              end_time: call.end_time,
              duration: call.duration
                ? `${Math.floor(call.duration / 60)}:${(call.duration % 60)
                    .toString()
                    .padStart(2, "0")}`
                : null,
              cost: call.cost ? `$${parseFloat(call.cost).toFixed(4)}` : null,
              recording: call.recording_url,
              contact: call.contact
                ? {
                    firstName: call.contact.firstName,
                    lastName: call.contact.lastName,
                    gender: call.contact.gender,
                  }
                : null,
            })),
            pagination: {
              total: count,
              page,
              totalPages: Math.ceil(count / limit),
              hasMore: offset + callLogs.length < count,
            },
          },
          campaign_stats: campaignStats,
        },
      };
    } catch (error) {
      console.error("Error getting campaign stats:", error);
      reply.code(500).send({ error: "Failed to get campaign statistics" });
    }
  });

  // Get call logs for a campaign
  fastify.get("/:id/calls", async (request, reply) => {
    try {
      const user_id = request.query.user_id;

      if (!user_id) {
        return reply.code(400).send({ error: "User ID is required" });
      }

      // First check if campaign belongs to user
      const campaign = await Campaign.findOne({
        where: {
          id: request.params.id,
          user_id,
        },
      });

      if (!campaign) {
        return reply
          .code(404)
          .send({ error: "Campaign not found or unauthorized access" });
      }

      const page = parseInt(request.query.page) || 1;
      const limit = parseInt(request.query.limit) || 10;
      const offset = (page - 1) * limit;

      const { count, rows } = await Call.findAndCountAll({
        where: { campaign_id: request.params.id },
        include: [
          {
            model: Contact,
            as: "contact",
            attributes: ["firstName", "lastName", "gender"],
          },
        ],
        order: [["createdAt", "DESC"]],
        limit,
        offset,
      });

      // Format calls to include contact information
      const formattedCalls = rows.map((call) => ({
        id: call.id,
        call_sid: call.call_sid,
        from_number: call.from_number,
        to_number: call.to_number,
        status: call.status,
        start_time: call.start_time,
        end_time: call.end_time,
        duration: call.duration,
        cost: call.cost,
        recording_url: call.recording_url,
        contact: call.contact
          ? {
              firstName: call.contact.firstName,
              lastName: call.contact.lastName,
              gender: call.contact.gender,
            }
          : null,
        createdAt: call.createdAt,
        updatedAt: call.updatedAt,
      }));

      return {
        calls: formattedCalls,
        total: count,
        page: page,
        totalPages: Math.ceil(count / limit),
      };
    } catch (error) {
      console.error("Error listing campaign calls:", error);
      reply.code(500).send({
        error: "Failed to list campaign calls",
        details: error.message,
      });
    }
  });

  // Add this new endpoint
  fastify.post("/create-with-csv", async (request, reply) => {
    try {
      // Initialize variables to store form data
      let csvFile;
      let name;
      let telnyxNumbers;
      let systemMessage;
      let firstMessage;
      let aiProvider;
      let voice;
      let voiceId;
      let language;
      let user_id;

      // Process all parts of the multipart form
      for await (const part of request.parts()) {
        if (part.type === "file") {
          csvFile = await part.toBuffer();
        } else {
          // Handle other form fields
          switch (part.fieldname) {
            case "name":
              name = part.value;
              break;
            case "telnyx_numbers":
              telnyxNumbers = JSON.parse(part.value);
              break;
            case "system_message":
              systemMessage = part.value;
              break;
            case "first_message":
              firstMessage = part.value;
              break;
            case "ai_provider":
              aiProvider = part.value;
            case "voice":
              voice = part.value;
              break;
            case "voice_id":
              voiceId = part.value;
              break;
            case "language":
              language = part.value;
              break;
            case "user_id":
              user_id = part.value;
              break;
          }
        }
      }

      // Validate required fields
      if (
        !csvFile ||
        !name ||
        !telnyxNumbers ||
        !systemMessage ||
        !firstMessage ||
        !aiProvider ||
        !user_id
      ) {
        return reply.code(400).send({
          error:
            "Missing required fields: file, name, telnyx_numbers, system_message, first_message, ai_provider, user_id",
        });
      }

      // Parse CSV
      const csvContent = csvFile.toString();
      const contacts = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      // Validate required fields
      const requiredFields = ["phoneNumber", "firstName", "lastName", "gender"];
      const missingFields = contacts.some((contact) =>
        requiredFields.some((field) => !contact[field])
      );

      if (missingFields) {
        return reply.code(400).send({
          error:
            "CSV must contain phoneNumber, firstName, lastName, and gender columns",
        });
      }

      // Format phone numbers by adding "+" if not present
      contacts.forEach((contact) => {
        if (contact.phoneNumber && !contact.phoneNumber.startsWith("+")) {
          contact.phoneNumber = "+" + contact.phoneNumber;
        }
      });

      // Extract phone numbers for campaign
      const phoneNumbers = contacts.map((contact) => contact.phoneNumber);

      console.log("baaaaaaaaaaaaaaaaaaaal", {
        name,
        all_numbers: phoneNumbers,
        numbers_to_call: phoneNumbers,
        telnyx_numbers: telnyxNumbers,
        system_message: systemMessage,
        first_message: firstMessage,
        ai_provider: aiProvider,
        voice: voice,
        voice_id: voiceId,
        language: language,
        status: "pending",
        total_calls: phoneNumbers.length,
      });

      // Create campaign with the parsed form data
      const campaign = await db.Campaign.create({
        name,
        all_numbers: phoneNumbers,
        numbers_to_call: phoneNumbers,
        telnyx_numbers: telnyxNumbers,
        system_message: systemMessage,
        first_message: firstMessage,
        ai_provider: aiProvider,
        voice: voice,
        voice_id: voiceId,
        language: language,
        status: "pending",
        total_calls: phoneNumbers.length,
        user_id, // Add user_id to campaign
      });

      // Create or update contacts
      await db.Contact.bulkCreate(
        contacts.map((contact) => ({
          phoneNumber: contact.phoneNumber,
          firstName: contact.firstName,
          lastName: contact.lastName,
          gender: contact.gender,
          email: contact.email || null,
          company: contact.company || null,
          notes: contact.notes || null,
          status: "Active",
          user_id, // Add user_id to all contacts
        })),
        {
          updateOnDuplicate: [
            "firstName",
            "lastName",
            "gender",
            "email",
            "company",
            "notes",
            "user_id", // Include user_id in updateOnDuplicate
          ],
          where: { phoneNumber: contacts.map((c) => c.phoneNumber) },
        }
      );

      return {
        success: true,
        campaign,
        contactsProcessed: contacts.length,
      };
    } catch (error) {
      console.error("Error creating campaign from CSV:", error);
      reply.code(500).send({
        error: "Failed to create campaign from CSV",
        details: error.message,
      });
    }
  });
}
