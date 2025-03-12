import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import fastifyCors from "@fastify/cors";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import axios from "axios";
import dotenv from "dotenv";
import Fastify from "fastify";
import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";
import sequelize from "./config/sequelize.js";
import Call from "./models/call.js";
import Campaign from "./models/campaign.js";
import callRoutes from "./routes/calls.js";
import campaignRoutes from "./routes/campaigns.js";
import contactRoutes from "./routes/contacts.js";
import telnyxNumberRoutes from "./routes/telnyxNumbers.js";
import { handleWebhook, processCampaignBatch } from "./services/campaign.js";

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

// Register routes
fastify.register(telnyxNumberRoutes);
fastify.register(callRoutes);
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

// TeXML handler for outbound calls
fastify.all("/outbound-call-handler", async (request, reply) => {
  console.log("🚀 ~ fastify.all ~ request-header-host:", request.headers.host);
  const websocketURL = `wss://${request.headers.host}/media-stream2`;
  console.log("🚀 ~ fastify.all ~ websocket:", websocketURL);
  const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                        <Response>                           
                            <Connect>
                                <Stream url="wss://${request.headers.host}/media-stream2" bidirectionalMode="rtp" />
                            </Connect>
                        </Response>`;

  reply.type("text/xml").send(texmlResponse);
});

// ... existing code ...

// Generate a unique session ID for tracking
const generateSessionId = () => uuidv4().substring(0, 8);

// Replace your entire WebSocket handler with this implementation
fastify.register(async (fastify) => {
  fastify.get("/media-stream2", { websocket: true }, (connection, req) => {
    const sessionId = generateSessionId();
    let lastActivity = Date.now();
    let isClosing = false;
    let lastStreamId = null;
    let deepgramReady = false;
    let lastConnectionAttempt = 0;
    let audioQueue = []; // Queue to store audio chunks before Deepgram is ready
    const MAX_QUEUE_SIZE = 50; // Limit queue size to prevent memory issues

    const logger = {
      info: (message) => console.log(`[${sessionId}] ${message}`),
      error: (message) => console.error(`[${sessionId}] ERROR: ${message}`),
      debug: (message) => console.debug(`[${sessionId}] DEBUG: ${message}`),
    };

    logger.info("New WebSocket connection established");
    logger.debug(`Telnyx connection properties: ${Object.keys(connection).join(', ')}`);

    const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
    let sttConnection;
    let activityCheckInterval;

    // Activity monitoring to prevent automatic disconnects
    const resetActivityTimer = () => {
      lastActivity = Date.now();
      if (!activityCheckInterval) {
        activityCheckInterval = setInterval(() => {
          if (Date.now() - lastActivity > 30000) {
            logger.error("Inactivity timeout - closing connection");
            safeClose();
          }
        }, 5000);
      }
    };

    const safeClose = () => {
      if (isClosing) return;
      isClosing = true;

      logger.info("Starting graceful shutdown");
      clearInterval(activityCheckInterval);

      try {
        if (sttConnection) {
          try {
            sttConnection.finish();
          } catch (e) {
            // Ignore finish errors
          }
          logger.debug("Deepgram connection closed");
        }
      } catch (error) {
        logger.error("Error closing Deepgram connection: " + error.message);
      }

      try {
        if (connection.socket && connection.socket.readyState === WebSocket.OPEN) {
          connection.socket.close();
        } else if (connection.readyState === WebSocket.OPEN) {
          connection.close();
        }
        logger.debug("WebSocket connection closed");
      } catch (error) {
        logger.error("Error closing WebSocket: " + error.message);
      }

      logger.info("Connection fully closed");
    };

    // Send message to Telnyx with fallback options
    const sendToTelnyx = (message) => {
      try {
        if (typeof message !== 'string') {
          message = JSON.stringify(message);
        }

        // Try different ways to send, based on the connection structure
        if (connection.socket && typeof connection.socket.send === 'function') {
          connection.socket.send(message);
          return true;
        } else if (typeof connection.send === 'function') {
          connection.send(message);
          return true;
        }
        
        logger.error("No valid send method found");
        return false;
      } catch (error) {
        logger.error(`Error sending to Telnyx: ${error.message}`);
        return false;
      }
    };

    // Initialize Deepgram STT
    const initSTT = () => {
      // Prevent rapid reconnections
      const now = Date.now();
      if (now - lastConnectionAttempt < 2000) {
        logger.debug("Throttling Deepgram connection attempts");
        return false;
      }
      
      lastConnectionAttempt = now;
      deepgramReady = false;
      
      try {
        // Close existing connection if any
        if (sttConnection) {
          try {
            sttConnection.finish();
          } catch (e) {
            // Ignore finish errors
          }
          sttConnection = null;
        }

        logger.info("Initializing Deepgram STT connection");
        
        // Create new connection with correct parameters
        sttConnection = deepgram.listen.live({
          model: "nova-2",
          language: "en-US",
          smart_format: true,
          encoding: "alaw",      // Telnyx uses PCMA which is a-law
          sample_rate: 8000,     // Standard telephony rate
          channels: 1,           // Mono audio
          interim_results: false,
          endpointing: 300,
        });

        // Set up event handlers
        sttConnection.on(LiveTranscriptionEvents.Open, () => {
          logger.info("✅ Deepgram connection established successfully");
          deepgramReady = true;
          
          // Process any queued audio
          processAudioQueue();
        });

        sttConnection.on(LiveTranscriptionEvents.Close, (event) => {
          logger.info(`Deepgram connection closed: ${event?.reason || 'No reason provided'}`);
          deepgramReady = false;
          sttConnection = null;
        });

        sttConnection.on(LiveTranscriptionEvents.Error, (error) => {
          logger.error(`Deepgram error: ${error.message}`);
          deepgramReady = false;
          sttConnection = null;
          
          // Try to reconnect after a delay if this was a connection error
          setTimeout(() => {
            if (!isClosing && !deepgramReady) {
              logger.info("Attempting to reconnect to Deepgram after error");
              initSTT();
            }
          }, 5000);
        });

        sttConnection.on(LiveTranscriptionEvents.Transcript, async (data) => {
          try {
            resetActivityTimer();
            const text = data.channel.alternatives[0]?.transcript;
            if (!text?.trim()) {
              logger.debug("Received empty transcript");
              return;
            }

            logger.info(`🎤 STT Result: "${text}"`);

            try {
              // Process with Groq
              logger.debug("Sending to Groq...");
              const llmResponse = await axios.post(
                "https://api.groq.com/v1/chat/completions",
                {
                  model: "mixtral-8x7b-32768",
                  messages: [
                    { role: "system", content: SYSTEM_MESSAGE },
                    { role: "user", content: text },
                  ],
                  temperature: 0.7,
                  max_tokens: 150,
                },
                {
                  headers: {
                    Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                    "Content-Type": "application/json",
                  },
                  timeout: 5000,
                }
              );
      
              const responseText = llmResponse.data.choices[0]?.message?.content;
              if (!responseText) {
                logger.error("Empty response from Groq");
                return;
              }
      
              logger.info(`🤖 LLM Response: "${responseText}"`);
              
              // Convert response to speech
              logger.debug("Generating TTS...");
              const ttsResponse = await axios.post(
                "https://api.deepgram.com/v1/speak",
                {
                  text: responseText,
                  model: "aura-asteria-en",  
                  encoding: "alaw",
                  sample_rate: 8000,
                },
                {
                  headers: {
                    Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
                    "Content-Type": "application/json",
                  },
                  responseType: "arraybuffer",
                  timeout: 5000,
                }
              );
    
              logger.debug(`📣 TTS audio generated: ${ttsResponse.data.byteLength} bytes`);
    
              // Send audio back to Telnyx
              const messageToSend = {
                event: "media",
                stream_id: lastStreamId,
                media: {
                  payload: Buffer.from(ttsResponse.data).toString('base64'),
                  track: "inbound"
                }
              };
              
              const sent = sendToTelnyx(messageToSend);
              if (sent) {
                logger.info("✅ Sent TTS audio to Telnyx");
              }
            } catch (error) {
              logger.error(`TTS/Send error: ${error.message}`);
              if (error.response) {
                logger.debug(`API Error Details: ${JSON.stringify(error.response.data)}`);
              }
            }
          } catch (error) {
            logger.error(`Transcript processing error: ${error.message}`);
          }
        });

        return true;
      } catch (error) {
        logger.error(`STT Initialization failed: ${error.message}`);
        logger.debug(`Stack trace: ${error.stack}`);
        deepgramReady = false;
        sttConnection = null;
        return false;
      }
    };

    // Process any audio chunks that were queued while waiting for Deepgram
    const processAudioQueue = () => {
      if (!deepgramReady || !sttConnection) return;
      
      logger.info(`Processing ${audioQueue.length} queued audio chunks`);
      
      while (audioQueue.length > 0 && deepgramReady) {
        const chunk = audioQueue.shift();
        try {
          sttConnection.send(chunk);
        } catch (e) {
          logger.error(`Error sending queued chunk: ${e.message}`);
          break;
        }
      }
    };

    // Function to generate and send a test audio message
    const sendTestAudio = async () => {
      try {
        if (!lastStreamId) {
          logger.error("Cannot send test audio - no stream_id available");
          return false;
        }
        
        const testText = "Hello, I can hear you now. This is a test response to verify the audio connection.";
        logger.info(`🔍 Sending test TTS with text: "${testText}"`);
        
        const ttsResponse = await axios.post(
          "https://api.deepgram.com/v1/speak",
          {
            text: testText,
            model: "aura-asteria-en",
            encoding: "alaw",
            sample_rate: 8000,
          },
          {
            headers: {
              Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
              "Content-Type": "application/json",
            },
            responseType: "arraybuffer",
            timeout: 5000,
          }
        );
        
        logger.debug(`📣 Test TTS audio generated: ${ttsResponse.data.byteLength} bytes`);
        
        const messageToSend = {
          event: "media",
          stream_id: lastStreamId,
          media: {
            payload: Buffer.from(ttsResponse.data).toString('base64'),
            track: "inbound"
          }
        };
        
        const sent = sendToTelnyx(messageToSend);
        if (sent) {
          logger.info("✅ Sent TEST audio to Telnyx");
          return true;
        } else {
          logger.error("Failed to send test audio");
          return false;
        }
      } catch (error) {
        logger.error(`Test audio error: ${error.message}`);
        return false;
      }
    };

    // Handle Telnyx messages
    connection.on("message", async (message) => {
      try {
        resetActivityTimer();
        
        // Parse message
        const data = JSON.parse(message);
        logger.debug(`Received message type: ${data.event}`);
        
        // Store the stream_id when available
        if (data.stream_id) {
          lastStreamId = data.stream_id;
          
          // If this is the start event, initialize Deepgram and send test audio
          if (data.event === "start") {
            logger.info("Call started - initializing Deepgram and scheduling test audio");
            
            // Initialize Deepgram
            initSTT();
            
            // Schedule test audio after a short delay
            setTimeout(async () => {
              try {
                await sendTestAudio();
              } catch (error) {
                logger.error(`Error sending initial test audio: ${error.message}`);
              }
            }, 2000);
          }
        }
        
        // Handle media specifically
        if (data.event === "media") {
          try {
            // Decode the audio data
            const audioChunk = Buffer.from(data.media.payload, "base64");
            logger.debug(`Received audio chunk: ${audioChunk.length} bytes`);
            
            // If Deepgram is ready, send directly
            if (deepgramReady && sttConnection) {
              try {
                sttConnection.send(audioChunk);
              } catch (e) {
                logger.error(`Error sending to Deepgram: ${e.message}`);
                deepgramReady = false;
                
                // Queue this chunk and try to reconnect
                audioQueue.push(audioChunk);
                initSTT();
              }
            } 
            // Otherwise, initialize if needed and queue the audio
            else {
              // Queue the audio (with a limit to prevent memory issues)
              if (audioQueue.length < MAX_QUEUE_SIZE) {
                audioQueue.push(audioChunk);
              }
              
              // Try to initialize Deepgram if not already in progress
              if (!sttConnection) {
                initSTT();
              }
            }
          } catch (error) {
            logger.error(`Error processing audio: ${error.message}`);
          }
        }
      } catch (error) {
        logger.error(`Message handling error: ${error.message}`);
      }
    });

    // Send another test message after a longer delay in case initial one fails
    setTimeout(async () => {
      try {
        if (lastStreamId && !isClosing) {
          logger.info("Sending follow-up test audio");
          await sendTestAudio();
        }
      } catch (error) {
        logger.error(`Error in follow-up test audio: ${error.message}`);
      }
    }, 10000);

    // Handle connection close
    connection.on("close", (code, reason) => {
      logger.info(`WebSocket closed (${code}) - ${reason?.toString() || 'No reason provided'}`);
      safeClose();
    });

    connection.on("error", (error) => {
      logger.error(`WebSocket error: ${error.message}`);
      safeClose();
    });

    // Send periodic keep-alive messages
    const keepAliveInterval = setInterval(() => {
      try {
        if (!isClosing) {
          const keepAliveMsg = { event: "keepalive", timestamp: Date.now() };
          sendToTelnyx(keepAliveMsg);
          logger.debug("Sent keep-alive message");
        }
      } catch (error) {
        logger.error(`Keep-alive failed: ${error.message}`);
      }
    }, 15000); // Every 15 seconds

    // Cleanup intervals on close
    connection.on("close", () => {
      clearInterval(keepAliveInterval);
    });

    // Log initial connection
    resetActivityTimer();
  });
});
// ... existing code ...

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