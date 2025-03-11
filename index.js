import fastifyCors from "@fastify/cors";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import axios from "axios";
import dotenv from "dotenv";
import Fastify from "fastify";
import WebSocket from "ws";
import sequelize from "./config/sequelize.js";
import Call from "./models/call.js";
import Campaign from "./models/campaign.js";
import callRoutes from "./routes/calls.js";
import userRoutes from "./routes/user.js";
import campaignRoutes from "./routes/campaigns.js";
import contactRoutes from "./routes/contacts.js";
import telnyxNumberRoutes from "./routes/telnyxNumbers.js";
import { handleWebhook, processCampaignBatch } from "./services/campaign.js";
import Contact from "./models/Contact.js";
import { createClient, LiveTTSEvents } from "@deepgram/sdk";
import fs from "fs";
import { pipeline } from "stream/promises";

// Load environment variables from .env file
dotenv.config();

// Retrieve the OpenAI API key from environment variables. You must have OpenAI Realtime API access.
const {
  OPENAI_API_KEY,
  TELNYX_API_KEY,
  TELNYX_CONNECTION_ID,
  TELNYX_PHONE_NUMBER,
} = process.env;
console.log("🚀 ~ TELNYX_API_KEY:", TELNYX_API_KEY);

if (!OPENAI_API_KEY) {
  console.error("Missing OpenAI API key. Please set it in the .env file.");
  process.exit(1);
}

if (!TELNYX_API_KEY) {
  console.error("Missing Telnyx API key. Please set it in the .env file.");
  process.exit(1);
}


// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs, {
  options: {
    // Use secure WebSocket in production
    server: fastify.server,
    clientTracking: true,
    perMessageDeflate: true,
  },
});
fastify.register(fastifyCors, {
  origin: "*", // Update this to your frontend URL in production
});

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);


// Register routes
fastify.register(telnyxNumberRoutes);
fastify.register(callRoutes);
fastify.register(userRoutes);
fastify.register(contactRoutes);
fastify.register(campaignRoutes, { prefix: "/api/campaigns" });

// Constants
let SYSTEM_MESSAGE =
  "You are a helpful and bubbly AI assistant who loves to chat about anything the user is interested about and is prepared to offer them facts.";
console.log("🚀 ~ SYSTEM_MESSAGE:", SYSTEM_MESSAGE);
const VOICE = process.env.VOICE || "alloy";
const PORT = process.env.PORT || 8000; // Allow dynamic port assignment

// List of Event Types to log to the console. See OpenAI Realtime API Documentation. (session.updated is handled separately.)
const LOG_EVENT_TYPES = [
  "response.content.done",
  "rate_limits.updated",
  "response.done",
  "input_audio_buffer.committed",
  "input_audio_buffer.speech_stopped",
  "input_audio_buffer.speech_started",
  "session.created",
];

// Root Route
fastify.get("/", async (request, reply) => {
  reply.send({ message: "Telnyx Media Stream Server is running!" });
});

// Route for Telnyx to handle incoming and outgoing calls
fastify.all("/incoming-call", async (request, reply) => {
  console.log(`Host:${request.headers.host}`);
  const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Connect>
                                  <Stream url="wss://${request.headers.host}/media-stream" bidirectionalMode="rtp" />
                              </Connect>
                          </Response>`;

  reply.type("text/xml").send(texmlResponse);
});

// Route for initiating outbound calls
fastify.post("/initiate-call", async (request, reply) => {
  console.log("Initiating call with:", request.body);
  const { to, from, system_message, campaign_id, contact_id } = request.body;

  try {
    const data = {
      To: to,
      From: from,
      UrlMethod: "GET",
      Record: "true",
      Url: `${process.env.PUBLIC_SERVER_URL}/outbound-call-handler`,
      StatusCallback: `${process.env.PUBLIC_SERVER_URL}/call-status`,
    };

    const config = {
      method: "post",
      url: `https://api.telnyx.com/v2/texml/calls/2632670363749713721`,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
      },
      data: data,
    };

    console.log("Making Telnyx API request:", config);
    const response = await axios.request(config);
    console.log("Telnyx API response:", response.data);

    // Extract call_sid from response
    const call_sid = response.data.call_sid;
    if (!call_sid) {
      throw new Error("No call_sid received from Telnyx");
    }

    // Create call record in database
    console.log("Creating call record with:", {
      call_sid,
      from_number: from,
      to_number: to,
      campaign_id,
      contact_id,
    });

    const call = await Call.create({
      call_sid,
      from_number: from,
      to_number: to,
      status: "queued",
      campaign_id,
      contact_id,
      system_message,
    });

    console.log("Call record created:", call.toJSON());
    reply.send(response.data);
  } catch (error) {
    console.error("Error making outbound call:", error.response?.data || error);
    reply.code(500).send({
      error: "Failed to initiate call",
      details: error.response?.data || error.message,
    });
  }
});

fastify.post("/text-to-speech", async (request, reply) => {
  try {
    const { text } = request.body;
    if (!text) {
      return reply.status(400).send({ error: "Text is required" });
    }

    const response = await deepgram.speak.request(
      { text },
      { model: "aura-asteria-en" }
    );

    const stream = await response.getStream();
    if (!stream) {
      return reply.status(500).send({ error: "Error generating audio" });
    }

    const outputFile = "output.mp3";
    const file = fs.createWriteStream(outputFile);
    await pipeline(stream, file);
    console.log(`Audio saved as ${outputFile}`);

    reply.header("Content-Type", "audio/mpeg");
    reply.header("Content-Disposition", 'attachment; filename="speech.mp3"');

    return reply.send(fs.createReadStream(outputFile)); // Send the audio file
  } catch (error) {
    console.error("Error:", error);
    reply.status(500).send({ error: "Something went wrong" });
  }
});

// TeXML handler for outbound calls
fastify.all("/outbound-call-handler", async (request, reply) => {
  console.log("🚀 ~ fastify.all ~ request-header-host:", request.headers.host);
  const websocketURL = `wss://${request.headers.host}/media-stream`;
  console.log("🚀 ~ fastify.all ~ websocket:", websocketURL);
  const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                        <Response>                           
                            <Connect>
                                <Stream url="wss://${request.headers.host}/media-stream2" bidirectionalMode="rtp" />
                            </Connect>
                        </Response>`;

  reply.type("text/xml").send(texmlResponse);
});

// Call status webhook handler
fastify.post("/call-status", async (request, reply) => {
  try {
    const webhookData = request.body;
    console.log("Call status webhook received:", webhookData);

    // Find the call record
    const callSid = webhookData.CallSid;
    const call = await Call.findOne({ where: { call_sid: callSid } });

    if (!call) {
      console.log(`No call found for SID: ${callSid}`);
      return reply.code(404).send({ error: "Call not found" });
    }

    console.log("Found call:", call.toJSON());

    // Handle different webhook types
    if (webhookData.CallbackSource === "call-progress-events") {
      // Update call status and duration
      const updates = {
        status: webhookData.CallStatus,
        duration: webhookData.CallDuration
          ? parseInt(webhookData.CallDuration)
          : call.duration,
        end_time:
          webhookData.CallStatus === "completed" ? new Date() : call.end_time,
      };

      await call.update(updates);
      console.log("Call updated successfully");

      // If call completed or failed, update campaign stats
      if (
        webhookData.CallStatus === "completed" ||
        ["failed", "no-answer", "busy"].includes(webhookData.CallStatus)
      ) {
        const campaign = await Campaign.findByPk(call.campaign_id);
        if (campaign) {
          console.log(
            `Updating campaign ${campaign.id} stats for ${webhookData.CallStatus} call`
          );

          // Get all calls for this number in this campaign
          const numberCalls = await Call.findAll({
            where: {
              campaign_id: campaign.id,
              to_number: call.to_number,
            },
          });

          // Check if all attempts for this number are completed or failed
          const allAttemptsFinished = numberCalls.every(
            (c) =>
              c.status === "completed" ||
              ["failed", "no-answer", "busy"].includes(c.status)
          );

          // Only remove from numbers_to_call if all attempts are finished
          if (allAttemptsFinished) {
            const remainingNumbers = campaign.numbers_to_call.filter(
              (num) => num !== call.to_number
            );
            await campaign.update({ numbers_to_call: remainingNumbers });
            console.log(`Removed ${call.to_number} from numbers_to_call`);

            // Update completed/failed counts
            if (numberCalls.some((c) => c.status === "completed")) {
              await campaign.increment("completed_calls");
            } else {
              await campaign.increment("failed_calls");
            }

            // Check if campaign is completed
            if (remainingNumbers.length === 0) {
              console.log(
                `Campaign ${campaign.id} completed - all numbers processed`
              );
              await campaign.update({ status: "completed" });
            } else {
              // Start next batch if there are remaining numbers
              console.log(`Starting next batch for campaign ${campaign.id}`);
              await processCampaignBatch(campaign);
            }
          }
        }
      }
    } else if (webhookData.CallbackSource === "call-cost-events") {
      // Update call cost and campaign total cost
      const costKey = `CallCost[${callSid}]`;
      const cost = webhookData[costKey];
      if (cost) {
        const parsedCost = parseFloat(cost);
        await call.update({ cost: parsedCost });

        // Update campaign total cost
        const campaign = await Campaign.findByPk(call.campaign_id);
        if (campaign) {
          await campaign.increment("total_cost", { by: parsedCost });
        }

        console.log("Call and campaign costs updated successfully");
      }
    } else if (webhookData.RecordingStatus === "completed") {
      // Update recording URL
      await call.update({ recording_url: webhookData.RecordingUrl });
      console.log("Call recording URL updated successfully");
    }

    reply.send({ success: true });
  } catch (error) {
    console.error("Error processing webhook:", error);
    reply.code(500).send({ error: "Failed to process webhook" });
  }
});

// Webhook handler for recording URLs
fastify.post("/webhook", async (request, reply) => {
  console.log("Webhook received:", request.body);
  try {
    const data = request.body;

    // Handle TeXML webhook format
    if (data.CallSid) {
      console.log("Processing TeXML webhook:", data);
      const call = await Call.findOne({ where: { call_sid: data.CallSid } });
      if (call) {
        const updates = {
          status: data.CallStatus,
          duration: data.CallDuration ? parseInt(data.CallDuration) : null,
          recording_url: data.RecordingUrl,
          end_time: data.EndTime ? new Date(data.EndTime) : null,
        };

        console.log("Updating call with TeXML data:", updates);
        await call.update(updates);
        console.log("Call updated successfully");

        // Update campaign stats if needed
        if (
          call.campaign_id &&
          (data.CallStatus === "completed" ||
            data.CallStatus === "failed" ||
            data.CallStatus === "no-answer")
        ) {
          const campaign = await Campaign.findByPk(call.campaign_id);
          if (campaign) {
            if (data.CallStatus === "completed") {
              await campaign.increment("completed_calls");
            } else {
              await campaign.increment("failed_calls");
            }
            console.log("Campaign stats updated");
          }
        }
      }
    }
    // Handle Telnyx webhook format
    else if (data.data?.event_type?.startsWith("call.")) {
      console.log("Processing Telnyx webhook:", data);
      const callSid =
        data.data.payload.call_control_id || data.data.payload.call_sid;
      const status = data.data.payload.result;
      const duration = data.data.payload.duration;
      const recordingUrl = data.data.payload.recording_url;

      const call = await Call.findOne({ where: { call_sid: callSid } });
      if (call) {
        const updates = {};

        if (status) updates.status = status;
        if (duration) updates.duration = parseInt(duration);
        if (recordingUrl) updates.recording_url = recordingUrl;

        console.log("Updating call with Telnyx data:", updates);
        await call.update(updates);
        console.log("Call updated successfully");

        // Update campaign stats if needed
        if (
          call.campaign_id &&
          (status === "completed" ||
            status === "failed" ||
            status === "no-answer")
        ) {
          const campaign = await Campaign.findByPk(call.campaign_id);
          if (campaign) {
            await campaign.increment(
              status === "completed" ? "completed_calls" : "failed_calls"
            );
            console.log("Campaign stats updated");
          }
        }
      }
    }

    await handleWebhook(data);
    reply.send({ status: "success" });
  } catch (error) {
    console.error("Error handling webhook:", error);
    reply
      .code(500)
      .send({ error: "Failed to process webhook", details: error.message });
  }
});

// WebSocket route for media-stream
fastify.register(async (fastify) => {
  fastify.get("/media-stream", { websocket: true }, (connection, req) => {
    console.log("Client connected");

    const openAiWs = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01",
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1",
        },
      }
    );

    let streamSid = null;

    const sendSessionUpdate = () => {
      const sessionUpdate = {
        type: "session.update",
        session: {
          turn_detection: { type: "server_vad" },
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
          voice: VOICE,
          instructions: SYSTEM_MESSAGE,
          modalities: ["text", "audio"],
          temperature: 0.8,
        },
      };

      console.log("Sending session update:", JSON.stringify(sessionUpdate));
      openAiWs.send(JSON.stringify(sessionUpdate));
    };

    // Open event for OpenAI WebSocket
    openAiWs.on("open", () => {
      console.log("Connected to the OpenAI Realtime API");
      setTimeout(sendSessionUpdate, 250); // Ensure connection stability, send after .25 seconds
    });

    // Listen for messages from the OpenAI WebSocket (and send to Telnyx if necessary)
    openAiWs.on("message", (data) => {
      try {
        const response = JSON.parse(data);

        if (LOG_EVENT_TYPES.includes(response.type)) {
          console.log(`Received event: ${response.type}`, response);
        }

        if (response.type === "session.updated") {
          console.log("Session updated successfully:", response);
        }

        if (response.type === "response.audio.delta" && response.delta) {
          const audioDelta = {
            event: "media",
            media: {
              payload: Buffer.from(response.delta, "base64").toString("base64"),
            },
          };
          connection.send(JSON.stringify(audioDelta));
        }
      } catch (error) {
        console.error(
          "Error processing OpenAI message:",
          error,
          "Raw message:",
          data
        );
      }
    });

    // Handle incoming messages from Telnyx
    connection.on("message", (message) => {
      try {
        const data = JSON.parse(message);

        switch (data.event) {
          case "media":
            if (openAiWs.readyState === WebSocket.OPEN) {
              const audioAppend = {
                type: "input_audio_buffer.append",
                audio: data.media.payload,
              };

              openAiWs.send(JSON.stringify(audioAppend));
            }
            break;
          case "start":
            streamSid = data.stream_id;
            console.log("Incoming stream has started", streamSid);
            break;
          default:
            console.log("Received non-media event:", data.event);
            break;
        }
      } catch (error) {
        console.error("Error parsing message:", error, "Message:", message);
      }
    });

    // Handle connection close
    connection.on("close", () => {
      if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      console.log("Client disconnected.");
    });

    // Handle WebSocket close and errors
    openAiWs.on("close", () => {
      console.log("Disconnected from the OpenAI Realtime API");
    });

    openAiWs.on("error", (error) => {
      console.error("Error in the OpenAI WebSocket:", error);
    });
  });
});

fastify.register(async (fastify) => {
  // Route for Deepgram Live TTS WebSocket
  // This endpoint accepts WebSocket connections and uses Deepgram's Live TTS API
  // to convert text to speech in real-time.
  // 
  // To use this endpoint:
  // 1. Connect to this WebSocket endpoint
  // 2. Send a message with event: "text" and text: "Your text to convert to speech"
  // 3. Receive audio data with event: "media" and media.payload containing base64 audio
  //
  // Example client message:
  // {
  //   "event": "text",
  //   "text": "Hello, this is a test message."
  // }
  fastify.get("/media-stream2", { websocket: true }, (connection, req) => {
    console.log("Client connected");

    let streamSid = null;
    let audioBuffer = Buffer.alloc(0);
    
    // Initialize Deepgram live TTS connection
    console.log("Initializing Deepgram live TTS connection...");
    const dgConnection = deepgram.speak.live({ 
      model: "aura-asteria-en",
      voice: "male",         // Specify a male voice
      encoding: "mulaw",     // Use mulaw encoding for compatibility with g711_ulaw
      sample_rate: 8000,     // Use 8kHz sample rate for telephony
      container: "none",     // No container format for raw audio
      volume: 2.0            // Increase volume (default is 1.0)
    });
    console.log("Deepgram connection initialized, waiting for open event...");

    // Set a timeout to check if the connection opened
    const connectionTimeout = setTimeout(() => {
      console.log("Deepgram connection timeout - connection state:", dgConnection.getReadyState());
      if (dgConnection.getReadyState() !== 1) { // Not OPEN
        console.log("Deepgram connection failed to open within timeout period");
      }
    }, 5000); // 5 second timeout

    // Handle Deepgram connection open event
    dgConnection.on(LiveTTSEvents.Open, () => {
      console.log("Connected to Deepgram Live TTS API");
      clearTimeout(connectionTimeout);
      
      // Send a welcome message when connection is established
      console.log("Waiting 1 second before sending welcome message...");
      setTimeout(() => {
        // Send multiple shorter messages instead of one long message
        const messages = [
          "Testing, testing, 1, 2, 3. Can you hear me?",
          "Hello! Welcome to our automated phone system.",
          "This is a test call using Deepgram's text to speech technology.",
          "If you can hear this message clearly, please press any key on your phone.",
          "I will now count from one to ten.",
          "One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten.",
          "Thank you for your attention. This concludes our test message."
        ];
        
        // Send each message with a delay between them
        const sendMessages = (index) => {
          if (index >= messages.length) return;
          
          const message = messages[index];
          console.log(`Sending message ${index + 1}/${messages.length}:`, message);
          dgConnection.sendText(message);
          dgConnection.flush();
          
          // Schedule the next message
          setTimeout(() => sendMessages(index + 1), 1500);
        };
        
        // Start sending messages
        sendMessages(0);
      }, 1000); // Wait 1 second before sending welcome message
      
      // Handle incoming audio data from Deepgram
      dgConnection.on(LiveTTSEvents.Audio, (data) => {
        console.log("Deepgram audio data received, length:", data.length);
        
        // Skip empty audio data
        if (!data || data.length === 0) {
          console.log("Received empty audio data, skipping");
          return;
        }
        
        try {
          // Convert the audio data to base64 for sending to client
          const buffer = Buffer.from(data);
          const base64Data = buffer.toString('base64');
          
          // Collect outgoing audio samples for analysis
          if (outgoingSampleCount < MAX_SAMPLES) {
            outgoingAudioSamples.push(buffer);
            outgoingSampleCount++;
            
            if (outgoingSampleCount === MAX_SAMPLES) {
              console.log(`Collected ${MAX_SAMPLES} outgoing audio samples, saving to file...`);
              saveAudioSamples(outgoingAudioSamples, "outgoing");
              outgoingAudioSamples = [];
            }
          }
          
          // Format the audio data for the client
          const audioDelta = {
            event: "media",
            media: {
              payload: base64Data,
            },
          };
          
          try {
            connection.send(JSON.stringify(audioDelta));
            console.log("Sent audio data to client, length:", data.length);
          } catch (error) {
            console.error("Error sending audio data to client:", error);
          }
        } catch (error) {
          console.error("Error processing audio data:", error);
        }
      });
      
      // Handle Deepgram flush event
      dgConnection.on(LiveTTSEvents.Flushed, () => {
        console.log("Deepgram Flushed");
        audioBuffer = Buffer.alloc(0); // Reset buffer after sending
      });
      
      // Handle Deepgram metadata event
      dgConnection.on(LiveTTSEvents.Metadata, (data) => {
        console.log("Deepgram metadata received:", data);
      });
      
      // Handle Deepgram errors
      dgConnection.on(LiveTTSEvents.Error, (err) => {
        console.error("Deepgram error:", err);
      });
      
      // Handle Deepgram connection close
      dgConnection.on(LiveTTSEvents.Close, () => {
        console.log("Deepgram connection closed");
      });
    });

    // Variables to collect audio samples
    let incomingAudioSamples = [];
    let outgoingAudioSamples = [];
    let incomingSampleCount = 0;
    let outgoingSampleCount = 0;
    const MAX_SAMPLES = 10;

    // Function to save collected audio samples to a file
    const saveAudioSamples = (samples, prefix) => {
      if (samples.length === 0) {
        console.log(`No ${prefix} audio samples to save`);
        return;
      }
      
      try {
        // Concatenate all audio samples
        const combinedBuffer = Buffer.concat(samples);
        
        // Save to file
        const filename = `${prefix}-audio-${Date.now()}.raw`;
        fs.writeFileSync(filename, combinedBuffer);
        console.log(`Saved ${samples.length} ${prefix} audio samples to ${filename}, total size: ${combinedBuffer.length} bytes`);
        
        return filename;
      } catch (error) {
        console.error(`Error saving ${prefix} audio samples:`, error);
        return null;
      }
    };

    // Function to process incoming audio data
    const processIncomingAudio = (audioData) => {
      // This function processes the incoming audio data
      console.log("Processing incoming audio data, length:", audioData.length);
      
      // Collect audio samples for analysis
      if (incomingSampleCount < MAX_SAMPLES) {
        incomingAudioSamples.push(audioData);
        incomingSampleCount++;
        
        if (incomingSampleCount === MAX_SAMPLES) {
          console.log(`Collected ${MAX_SAMPLES} incoming audio samples, saving to file...`);
          saveAudioSamples(incomingAudioSamples, "incoming");
          incomingAudioSamples = [];
        }
      }
    };

    // Handle incoming messages from client
    connection.on("message", (message) => {
      try {
        const data = JSON.parse(message);

        switch (data.event) {
          case "media":
            // We're receiving media from the client, but we don't need to process it
            // Just log it once in a while to avoid flooding the console
            if (Math.random() < 0.01) { // Only log approximately 1% of media events
                console.log("Received media from client");
                
                // Log details about the media payload
                try {
                    const mediaInfo = {
                        hasPayload: !!data.media && !!data.media.payload,
                        payloadLength: data.media && data.media.payload ? data.media.payload.length : 0,
                        payloadType: data.media && data.media.payload ? typeof data.media.payload : 'none',
                        track: data.media && data.media.track ? data.media.track : 'unknown',
                        otherKeys: Object.keys(data).filter(key => key !== 'event' && key !== 'media')
                    };
                    
                    if (data.media && data.media.payload) {
                        // Try to decode a small sample of the payload to see what it contains
                        try {
                            const sampleLength = Math.min(20, data.media.payload.length);
                            const sample = data.media.payload.substring(0, sampleLength);
                            mediaInfo.payloadSample = sample + (sampleLength < data.media.payload.length ? '...' : '');
                            
                            // Process the audio data (for analysis)
                            if (incomingSampleCount < MAX_SAMPLES) {
                                const audioBuffer = Buffer.from(data.media.payload, 'base64');
                                processIncomingAudio(audioBuffer);
                            }
                        } catch (e) {
                            mediaInfo.payloadSample = 'Error getting sample';
                        }
                    }
                    
                    console.log("Media details:", JSON.stringify(mediaInfo, null, 2));
                } catch (error) {
                    console.error("Error analyzing media data:", error);
                }
            }
            break;
          case "text":
            // If client sends text to be synthesized
            if (!data.text) {
              console.error("Received text event without text property");
              break;
            }
            
            if (dgConnection.getReadyState() === 1) { // OPEN
              console.log("Sending text to Deepgram:", data.text);
              dgConnection.sendText(data.text);
              dgConnection.flush();
            } else {
              console.log("Deepgram connection not open, cannot send text");
            }
            break;
          case "start":
            streamSid = data.stream_id;
            console.log("Incoming stream has started", streamSid);
            break;
          default:
            console.log("Received non-media event:", data.event);
            break;
        }
      } catch (error) {
        console.error("Error parsing message:", error, "Message:", message);
      }
    });

    // Handle connection close
    connection.on("close", () => {
      if (dgConnection.getReadyState() === 1) { // OPEN
        try {
          // Use finish() instead of close() to properly close the Deepgram connection
          dgConnection.finish();
          console.log("Deepgram connection finished");
        } catch (error) {
          console.error("Error closing Deepgram connection:", error);
        }
      }
      console.log("Client disconnected.");
    });
  });
});

// Test database connection
try {
  await sequelize.authenticate();
  console.log("Database connection has been established successfully.");

  // Sync database (in development)
  if (process.env.NODE_ENV !== "production") {
    await sequelize.sync({ alter: true });
    console.log("Database synced successfully");
  }
} catch (error) {
  console.error("Unable to connect to the database:", error);
}

fastify.listen({ port: PORT }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server is listening on port ${PORT}`);
});
