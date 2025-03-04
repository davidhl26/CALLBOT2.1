import axios from "axios";
import Call from "../models/call.js";
import Campaign from "../models/campaign.js";
import Contact from "../models/Contact.js";

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

async function makeCallWithRetry(
  toNumber,
  fromNumber,
  systemMessage,
  campaignId,
  contactId,
  retries = 0
) {
  try {
    // First try the local endpoint
    const response = await axios.post(
      `${process.env.PUBLIC_SERVER_URL}/initiate-call`,
      {
        to: toNumber,
        from: fromNumber,
        system_message: systemMessage,
        campaign_id: campaignId,
        contact_id: contactId,
      }
    );
    return { success: true, data: response.data };
  } catch (error) {
    console.error(
      `Error making call to ${toNumber} (attempt ${retries + 1}):`,
      error.message
    );

    // If we get a network error or 500, and haven't exceeded retries, try again
    if (
      (error.code === "ENETUNREACH" || error.response?.status === 500) &&
      retries < MAX_RETRIES
    ) {
      console.log(`Retrying call to ${toNumber} in ${RETRY_DELAY}ms...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return makeCallWithRetry(
        toNumber,
        fromNumber,
        systemMessage,
        campaignId,
        contactId,
        retries + 1
      );
    }

    return {
      success: false,
      error: error.message,
      toNumber,
      unresponsive: true,
    };
  }
}

// Process a batch of numbers for a campaign
async function processCampaignBatch(campaign) {
  if (!campaign || campaign.status !== "in_progress") {
    return;
  }

  try {
    // Get remaining numbers to call
    let remainingNumbers = campaign.numbers_to_call || [];
    console.log(
      `Processing batch of ${remainingNumbers.length} numbers for campaign ${campaign.id}`
    );

    // Get batch size based on available Telnyx numbers
    const batchSize = Math.min(
      campaign.telnyx_numbers.length,
      remainingNumbers.length
    );
    if (batchSize === 0) {
      console.log(
        `Campaign ${campaign.id} completed - no more numbers to call`
      );
      await campaign.update({ status: "completed" });
      return;
    }

    // Get current batch
    const currentBatch = remainingNumbers.slice(0, batchSize);

    // Process each number in the batch
    const calls = await Promise.all(
      currentBatch.map(async (toNumber, index) => {
        const fromNumber = campaign.telnyx_numbers[index];
        console.log(`Initiating call from ${fromNumber} to ${toNumber}`);

        // Find or create contact for this number
        const [contact] = await Contact.findOrCreate({
          where: { phoneNumber: toNumber },
          defaults: {
            firstName: "Unknown",
            lastName: "Contact",
            gender: "mr",
            status: "Active",
          },
        });

        // Make the call with contact_id
        return makeCallWithRetry(
          toNumber,
          fromNumber,
          campaign.system_message,
          campaign.id,
          contact.id
        );
      })
    );

    // Wait for all calls in batch to start
    await Promise.all(calls);
    console.log("Waiting for call webhooks before processing next batch...");
  } catch (error) {
    console.error(`Error processing campaign batch: ${error}`);
    throw error;
  }
}

// Restart a campaign - call all numbers again
async function restartCampaign(campaign) {
  try {
    // Reset campaign stats
    await campaign.update({
      completed_calls: 0,
      failed_calls: 0,
      numbers_to_call: campaign.all_numbers, // Use all numbers
      status: "in_progress",
    });

    // Start processing batches
    await processCampaignBatch(campaign);
  } catch (error) {
    console.error(`Error restarting campaign: ${error}`);
    throw error;
  }
}

// Recycle a campaign - only call failed/unanswered numbers
async function recycleCampaign(campaign) {
  try {
    // Get all calls for this campaign
    const calls = await Call.findAll({
      where: {
        campaign_id: campaign.id,
        status: ["failed", "no-answer", "busy"],
      },
    });

    // Get numbers to recycle
    const numbersToRecycle = calls.map((call) => call.to_number);

    if (numbersToRecycle.length === 0) {
      console.log(`No numbers to recycle for campaign ${campaign.id}`);
      return;
    }

    // Update campaign for recycling
    await campaign.update({
      completed_calls: 0,
      failed_calls: 0,
      numbers_to_call: numbersToRecycle,
      status: "in_progress",
    });

    // Start processing batches
    await processCampaignBatch(campaign);
  } catch (error) {
    console.error(`Error recycling campaign: ${error}`);
    throw error;
  }
}

// Handle webhook events
async function handleWebhook(data) {
  console.log("Call status update:", data.event_type, data.payload);
  try {
    const callSid = data.payload.call_control_id || data.payload.call_leg_id;
    if (!callSid) {
      console.log("No call SID found in webhook data");
      return;
    }

    const call = await Call.findOne({
      where: { call_sid: callSid },
      include: [{ model: Campaign }],
    });

    if (!call) {
      console.log("Call not found:", callSid);
      return;
    }

    // Handle different webhook event types
    switch (data.event_type) {
      case "call.answered":
        call.status = "in-progress";
        call.start_time = new Date();
        break;

      case "call.hangup":
      case "call.completed":
        call.status = "completed";
        call.end_time = new Date();
        if (data.payload.call_duration) {
          call.duration = parseInt(data.payload.call_duration);
        }
        // Update campaign stats
        if (call.campaign_id) {
          await Campaign.increment("completed_calls", {
            where: { id: call.campaign_id },
          });
        }
        break;

      case "call.recording.saved":
        if (data.payload.recording_url) {
          call.recording_url = data.payload.recording_url;
          console.log("Updated recording URL:", data.payload.recording_url);
        }
        break;

      case "call.cost":
        if (data.payload.cost) {
          call.cost = parseFloat(data.payload.cost);
        }
        break;

      case "call.failed":
      case "call.no-answer":
        call.status = "failed";
        call.end_time = new Date();
        // Update campaign stats
        if (call.campaign_id) {
          await Campaign.increment("failed_calls", {
            where: { id: call.campaign_id },
          });
        }
        break;
    }

    await call.save();

    // Check if we should start next batch
    if (
      call.campaign_id &&
      ["completed", "failed", "no-answer"].includes(call.status)
    ) {
      const campaign = await Campaign.findByPk(call.campaign_id);
      if (campaign && campaign.status === "in_progress") {
        // Check if all calls in current batch are done
        const activeCalls = await Call.count({
          where: {
            campaign_id: call.campaign_id,
            to_number: campaign.numbers_in_current_batch,
            status: "in-progress",
          },
        });

        if (activeCalls === 0 && campaign.numbers_to_call.length > 0) {
          console.log(
            `All calls in batch completed, starting next batch for campaign ${campaign.id}`
          );
          processCampaignBatch(campaign);
        }
      }
    }
  } catch (error) {
    console.error("Error processing webhook:", error);
  }
}

// Export the campaign functions
export {
  handleWebhook,
  makeCallWithRetry,
  processCampaignBatch,
  recycleCampaign,
  restartCampaign,
};
