import axios from "axios";
import Call from "../models/call.js";
import Contact from "../models/Contact.js";

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

async function makeCallWithRetry(
  toNumber,
  fromNumber,
  systemMessage,
  firstMessage,
  aiProvider,
  voice,
  voiceId,
  language,
  campaignId,
  contactId,
  user_id,
  retries = 0
) {
  try {
    // Ensure phone numbers have '+' prefix
    const formattedToNumber = toNumber.startsWith("+")
      ? toNumber
      : "+" + toNumber;
    const formattedFromNumber = fromNumber.startsWith("+")
      ? fromNumber
      : "+" + fromNumber;

    //determinne endpoint based on aiProvider
    let endpoint;
    if (aiProvider === "eleven_labs") {
      endpoint = `${process.env.PUBLIC_SERVER_URL}/initiate-call-eleven-labs`;
    } else if (aiProvider === "real-time-api") {
      endpoint = `${process.env.PUBLIC_SERVER_URL}/initiate-call-real-time-api`;
    } else if (aiProvider === "groq+deepgram") {
      endpoint = `${process.env.PUBLIC_SERVER_URL}/initiate-call-groq-deepgram`;
    } else {
      console.error(`Unknown AI provider: ${aiProvider}`);
      endpoint = `${process.env.PUBLIC_SERVER_URL}/initiate-call-eleven-labs`; // Default to ElevenLabs
    }

    console.log(
      `Calling endpoint ${endpoint} with to=${formattedToNumber}, from=${formattedFromNumber}, aiProvider=${aiProvider}`
    );

    // First try the local endpoint
    const response = await axios.post(endpoint, {
      to: formattedToNumber,
      from: formattedFromNumber,
      system_message: systemMessage,
      first_message: firstMessage,
      ai_provider: aiProvider,
      voice: voice,
      voice_id: voiceId,
      language: language,
      campaign_id: campaignId,
      contact_id: contactId,
      user_id: user_id,
    });
    return { success: true, data: response.data };
  } catch (error) {
    console.error(
      `Error making call to ${toNumber} (attempt ${retries + 1}):`,
      error.message
    );

    // Log more detailed error information to help debug
    if (error.response) {
      console.error(`Response status: ${error.response.status}`);
      console.error(`Response data:`, error.response.data);
      console.error(`Response headers:`, error.response.headers);
    } else if (error.request) {
      console.error(`No response received. Request:`, error.request);
    } else {
      console.error(`Error details:`, error);
    }

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
        firstMessage,
        aiProvider,
        voice,
        voiceId,
        language,
        campaignId,
        contactId,
        user_id,
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
    // Get remaining numbers to call, excluding those already in progress
    let remainingNumbers = campaign.numbers_to_call || [];
    const inProgressNumbers = campaign.in_progress_numbers || [];

    // Filter out numbers that are currently in progress
    const availableNumbers = remainingNumbers.filter(
      (number) => !inProgressNumbers.includes(number)
    );

    console.log(
      `Processing batch of ${availableNumbers.length} available numbers for campaign ${campaign.id}`
    );

    if (availableNumbers.length === 0) {
      // If no available numbers, check if there are any in-progress numbers
      if (inProgressNumbers.length > 0) {
        console.log(
          `Campaign ${campaign.id} - waiting for ${inProgressNumbers.length} in-progress calls to complete`
        );
        return; // Exit and wait for in-progress calls to complete
      }

      // If no in-progress numbers and no available numbers, campaign is completed
      console.log(
        `Campaign ${campaign.id} completed - no more numbers to call`
      );
      await campaign.update({ status: "completed" });
      return;
    }

    // Get batch size based on available Telnyx numbers
    const batchSize = Math.min(
      campaign.telnyx_numbers.length,
      availableNumbers.length
    );
    if (batchSize === 0) {
      console.log(`Campaign ${campaign.id} - no Telnyx numbers available`);
      return;
    }

    // Get current batch
    const currentBatch = availableNumbers.slice(0, batchSize);

    // Add current batch to in-progress numbers
    const updatedInProgressNumbers = [...inProgressNumbers, ...currentBatch];
    await campaign.update({ in_progress_numbers: updatedInProgressNumbers });

    console.log(
      `Added ${currentBatch.length} numbers to in-progress: ${JSON.stringify(
        currentBatch
      )}`
    );

    // Process each number in the batch
    const calls = await Promise.all(
      currentBatch.map(async (toNumber, index) => {
        const fromNumber = campaign.telnyx_numbers[index];
        console.log(`Initiating call from ${fromNumber} to ${toNumber}`);

        // Find or create contact for this number
        const [contact] = await Contact.findOrCreate({
          where: {
            phoneNumber: toNumber,
            user_id: campaign.user_id,
          },
          defaults: {
            firstName: "Unknown",
            lastName: "Contact",
            gender: "mr",
            status: "Active",
            user_id: campaign.user_id, // Include user_id in defaults
          },
        });

        // Make the call with contact_id
        return makeCallWithRetry(
          toNumber,
          fromNumber,
          campaign.system_message,
          campaign.first_message,
          campaign.ai_provider,
          campaign.voice,
          campaign.voice_id,
          campaign.language,
          campaign.id,
          contact.id,
          campaign.user_id
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
      in_progress_numbers: [], // Reset in-progress numbers
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
    const allCalls = await Call.findAll({
      where: {
        campaign_id: campaign.id,
      },
      order: [["start_time", "DESC"]], // Get most recent calls first
    });

    // Group calls by phone number to find the latest status for each number
    const callsByNumber = {};
    allCalls.forEach((call) => {
      const phoneNumber = call.to_number;
      // Only track this call if we haven't seen this number before (since we ordered by most recent)
      if (!callsByNumber[phoneNumber]) {
        callsByNumber[phoneNumber] = call;
      }
    });

    // Get numbers to recycle - those whose most recent call status is failed/no-answer/busy
    const numbersToRecycle = Object.values(callsByNumber)
      .filter((call) => ["failed", "no-answer", "busy"].includes(call.status))
      .map((call) => call.to_number);

    console.log(
      `Found ${numbersToRecycle.length} numbers to recycle for campaign ${campaign.id}`
    );

    if (numbersToRecycle.length === 0) {
      console.log(`No numbers to recycle for campaign ${campaign.id}`);
      return;
    }

    // Update campaign for recycling
    await campaign.update({
      numbers_to_call: numbersToRecycle,
      in_progress_numbers: [], // Reset in-progress numbers
      status: "in_progress",
    });

    // Start processing batches
    await processCampaignBatch(campaign);
  } catch (error) {
    console.error(`Error recycling campaign: ${error}`);
    throw error;
  }
}

// Export the campaign functions
export {
  makeCallWithRetry,
  processCampaignBatch,
  recycleCampaign,
  restartCampaign,
};
