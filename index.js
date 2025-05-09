import {
  createClient,
  LiveTranscriptionEvents,
  LiveTTSEvents,
} from "@deepgram/sdk";
import fastifyCors from "@fastify/cors";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import axios from "axios";
import dotenv from "dotenv";
import Fastify from "fastify";
import Groq from "groq-sdk";
import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";
import sequelize from "./config/sequelize.js";
import Call from "./models/call.js";
import Campaign from "./models/campaign.js";
import callRoutes from "./routes/calls.js";
import campaignRoutes from "./routes/campaigns.js";
import contactRoutes from "./routes/contacts.js";
import elevenLabsRoutes from "./routes/elevenLabsRoutes.js";
import googleCalenderRoutes from "./routes/googleCalenderRoutes.js";
import telnyxNumberRoutes from "./routes/telnyxNumbers.js";
import userRoutes from "./routes/user.js";
import webhookRoutes from "./routes/webhook.routes.js";
import { processCampaignBatch } from "./services/campaign.js";
import { cleanupCall } from "./utils/callCleanup.js";
import { getSignedUrl } from "./utils/elevenLabs.js";
import { generateSystemPrompt } from "./utils/generateSystemPrompt.js";
import { bookCalendarEvent } from "./utils/googleCalendar.js";

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
fastify.register(elevenLabsRoutes);
fastify.register(userRoutes);
fastify.register(googleCalenderRoutes, { prefix: "/api/google-calendar" });
fastify.register(webhookRoutes, { prefix: "/api/webhooks" });
const now = new Date();
const formattedDate = now.toLocaleDateString("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const formattedTime = now.toLocaleTimeString("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

let unique_id = "";

// Constants
let SYSTEM_MESSAGE = `
You are a voice assistant for Mary's Dental, a dental office at 123 North Face Place, Anaheim, California. 
Speak casually, like a real person on a phone call—short and to the point. 

Today is ${formattedDate}, and the time is ${formattedTime}. Use this info when responding.

- Keep responses **brief** (1-2 sentences max).
- Use natural conversation fillers: "Umm...", "Well...", "I mean..."
- Be witty, but **don't ramble**.
- If booking an appointment, gather info step by step using a tool call.

### **Booking Flow (Use \`schedule_appointment\` Tool Call)**
1. Ask for their full name.  
2. Ask why they need the appointment.  
3. Ask for their preferred date and time.  
4. Call \`schedule_appointment\` and confirm.  

### **Example Call Handling:**
**User:** "Hi"  
**Assistant:** "Hello, this is Mary's Dental. How can I help?"  

**User:** "What are your hours?"  
**Assistant:** "Oh! We're open 8 AM to 5 PM. Closed Sundays!"  

**User:** "Can I book an appointment?"  
**Assistant:** "Sure! What's your name?"  

**User:** "John Doe."  
**Assistant:** "Alright, John! What do you need the appointment for?"  

**User:** "A cleaning."  
**Assistant:** "Got it! When works best for you?"  

**User:** "Tomorrow at 10 AM."  
**Assistant (calls \`schedule_appointment\`):**  
"Perfect! You're all set for 10 AM tomorrow."  
`;

// console.log("🚀 ~ SYSTEM_MESSAGE:", SYSTEM_MESSAGE);
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
fastify.post("/initiate-call-real-time-api", async (request, reply) => {
  console.log("Initiating call with:", request.body);
  const { to, from, system_message, campaign_id, contact_id } = request.body;

  try {
    const data = {
      To: to,
      From: from,
      UrlMethod: "GET",
      Record: "true",
      Url: `${process.env.PUBLIC_SERVER_URL}/outbound-call-handler-real-time-api`,
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

// Route for initiating outbound calls with eleven labs
fastify.post("/initiate-call-eleven-labs", async (request, reply) => {
  console.log("Initiating ElevenLabs call with:", {
    to: request.body.to,
    from: request.body.from,
    campaign_id: request.body.campaign_id,
    contact_id: request.body.contact_id,
    first_message: request.body.first_message,
    voice: request.body.voice,
    voice_id: request.body.voice_id,
    language: request.body.language,
    user_id: request.body.user_id,
  });

  const {
    to,
    from,
    system_message,
    campaign_id,
    contact_id,
    first_message,
    voice,
    language,
    voice_id,
    user_id,
  } = request.body;

  console.log("🚀 ~ request.body:", request.body);

  // get voice id from voice
  let voice_id_final = voice_id;
  try {
    if (voice_id === "") {
      switch (voice) {
        case "voice_english_male_1":
          voice_id_final = process.env.ELEVENLABS_VOICE_ENGLISH_MALE_1;
          break;
        case "voice_english_male_2":
          voice_id_final = process.env.ELEVENLABS_VOICE_ENGLISH_MALE_2;
          break;
        case "voice_english_female_1":
          voice_id_final = process.env.ELEVENLABS_VOICE_ENGLISH_FEMALE_1;
          break;
        case "voice_french_male_1":
          voice_id_final = process.env.ELEVENLABS_VOICE_FRENCH_MALE_1;
          break;
        default:
          voice_id_final = process.env.ELEVENLABS_VOICE_ENGLISH_MALE_1;
          break;
      }
    }
  } catch (error) {
    console.error("Error getting voice id:", error);
  }
  // Validate required parameters
  if (!to || !from) {
    return reply.code(400).send({
      error:
        "Missing required parameters: 'to' and 'from' phone numbers are required",
    });
  }

  // Check for ElevenLabs credentials
  if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_AGENT_ID) {
    return reply.code(400).send({
      error:
        "ElevenLabs credentials are missing. Please set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID in your .env file.",
    });
  }
  //for tracking purposes
  unique_id = uuidv4();

  try {
    // Create a safe version of system_message and first_message for URL
    const encodedSystemMessage = encodeURIComponent(system_message);
    const encodedFirstMessage = encodeURIComponent(first_message);

    const data = {
      To: to,
      From: from,
      UrlMethod: "GET",
      Record: "true",
      Url: `${process.env.PUBLIC_SERVER_URL}/outbound-call-handler-eleven-labs?system_message=${encodedSystemMessage}&first_message=${encodedFirstMessage}&voice_id=${voice_id_final}&language=${language}&user_id=${user_id}&unique_id=${unique_id}`,
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

    console.log("Making Telnyx API request with ElevenLabs config:", {
      to: data.To,
      from: data.From,
      url: data.Url.substring(0, 100) + "...", // Truncate for logging
    });

    const response = await axios.request(config);
    console.log("Telnyx API response:", response.data);

    // Extract call_sid from response
    const call_sid = response.data.call_sid;
    if (!call_sid) {
      throw new Error("No call_sid received from Telnyx");
    }

    // Create call record in database
    console.log("Creating ElevenLabs call record with:", {
      call_sid,
      from_number: from,
      to_number: to,
      campaign_id,
      contact_id,
      provider: "eleven_labs",
    });

    const call = await Call.create({
      call_sid,
      from_number: from,
      to_number: to,
      status: "queued",
      campaign_id,
      contact_id,
      system_message,
      first_message,
      provider: "eleven_labs",
      unique_id,
    });

    console.log("ElevenLabs call record created:", call.toJSON());
    reply.send(response.data);
  } catch (error) {
    console.error(
      "Error making ElevenLabs outbound call:",
      error.response?.data || error
    );
    reply.code(500).send({
      error: "Failed to initiate the call",
      details: error.response?.data || error.message,
    });
  }
});

// TeXML handler for outbound calls
fastify.all("/outbound-call-handler-real-time-api", async (request, reply) => {
  console.log("🚀 ~ fastify.all ~ request-header-host:", request.headers.host);
  const websocketURL = `wss://${request.headers.host}/media-stream`;
  console.log("🚀 ~ fastify.all ~ websocket:", websocketURL);
  const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                        <Response>                           
                            <Connect>
                                <Stream url="wss://${request.headers.host}/media-stream" bidirectionalMode="rtp" />
                            </Connect>
                        </Response>`;

  reply.type("text/xml").send(texmlResponse);
});

// TeXML handler for outbound calls with eleven labs
fastify.all("/outbound-call-handler-eleven-labs", async (request, reply) => {
  const system_message = request.query.system_message || "";
  const first_message = request.query.first_message || "";
  const voice_id = request.query.voice_id;
  const language = request.query.language || "en";
  const user_id = request.query.user_id;
  console.log("[ElevenLabs TeXML Handler] Received parameters:", {
    system_message: system_message.substring(0, 100) + "...",
    first_message,
    voice_id,
    language,
    user_id,
    unique_id,
  });

  // XML-encode the parameters
  const xmlEncodedSystemMessage = system_message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  const xmlEncodedFirstMessage = first_message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  // Create the TeXML response with properly encoded parameters
  const texmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
        <Connect>
            <Stream url="wss://${request.headers.host}/media-stream-eleven-labs"  bidirectionalMode="rtp">
                <Parameter name="system_message" value="${xmlEncodedSystemMessage}" />
                <Parameter name="first_message" value="${xmlEncodedFirstMessage}" />
                <Parameter name="voice_id" value="${voice_id}" />
                <Parameter name="language" value="${language}" />
                <Parameter name="user_id" value="${user_id}" />
                <Parameter name="unique_id" value="${unique_id}" />
            </Stream>
        </Connect>
    </Response>`;

  reply.type("text/xml").send(texmlResponse);
});

// WebSocket route for handling media streams with eleven labs
fastify.register(async (fastifyInstance) => {
  fastifyInstance.get(
    "/media-stream-eleven-labs",
    { websocket: true },
    (ws, req) => {
      console.info("[Server] Telnyx connected to outbound media stream");

      // Variables to track the call
      let streamSid = null;
      let callSid = null;
      let elevenLabsWs = null;
      let customParameters = null; // Add this to store parameters
      let callControlId = null;
      let initialConfigSent = false; // Track if config has been sent
      let inactivityTimeout = null; // Add timeout to detect inactivity
      let lastActivity = Date.now(); // Track last activity
      let isClosing = false; // Track if we're in the process of closing

      // Function to forcibly close connections after inactivity
      const setupInactivityTimeout = () => {
        // Clear any existing timeout
        if (inactivityTimeout) {
          clearTimeout(inactivityTimeout);
        }

        // Set a new timeout - close connections after 2 minutes of inactivity
        inactivityTimeout = setTimeout(() => {
          console.log(
            "[ElevenLabs] Inactivity timeout reached, closing connections"
          );
          forceCleanup();
        }, 120000); // 2 minutes
      };

      // Update last activity timestamp and reset timeout
      const updateActivity = () => {
        lastActivity = Date.now();
        setupInactivityTimeout();
      };

      // Force cleanup of all connections
      const forceCleanup = async () => {
        if (isClosing) return; // Prevent multiple cleanup attempts
        isClosing = true;

        console.log("[Cleanup] Force closing connections due to inactivity");

        // Attempt to hang up the call if we have a call control ID
        if (callControlId) {
          try {
            await cleanupCall(callControlId, ws, elevenLabsWs);
          } catch (error) {
            console.error("[Cleanup] Error in forced cleanup:", error);
          }
        }

        // Ensure ElevenLabs connection is closed
        if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
          try {
            console.log("[Cleanup] Force closing ElevenLabs connection");
            elevenLabsWs.close();
          } catch (error) {
            console.error(
              "[Cleanup] Error closing ElevenLabs connection:",
              error
            );
          }
        }

        // Ensure Telnyx connection is closed
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            console.log("[Cleanup] Force closing Telnyx connection");
            ws.close();
          } catch (error) {
            console.error("[Cleanup] Error closing Telnyx connection:", error);
          }
        }

        // Clear the timeout
        if (inactivityTimeout) {
          clearTimeout(inactivityTimeout);
          inactivityTimeout = null;
        }
      };

      // Function to send initial config only when we have parameters
      const sendInitialConfig = () => {
        if (!elevenLabsWs || elevenLabsWs.readyState !== WebSocket.OPEN) {
          console.error("[ElevenLabs] Cannot send config - WebSocket not open");
          return false;
        }

        if (!customParameters) {
          console.error(
            "[ElevenLabs] Cannot send initial config - missing parameters"
          );
          return false;
        }

        if (initialConfigSent) {
          console.log("[ElevenLabs] Initial config already sent, skipping");
          return false;
        }
        console.log(
          "🚀 ~ sendInitialConfig ~ customParameters:",
          customParameters
        );

        //append user_id to system_message
        const system_message_with_user_id = `${customParameters.system_message}\n\nUser ID: ${customParameters.user_id}`;

        const initialConfig = {
          type: "conversation_initiation_client_data",
          dynamic_variables: {
            call_id: callSid || streamSid || "unknown",
            user_id: customParameters.user_id,
            unique_id: customParameters.unique_id,
          },
          conversation_config_override: {
            agent: {
              prompt: {
                // prompt: customParameters.system_message,
                // prompt: system_message_with_user_id,
                prompt: generateSystemPrompt({
                  userId: customParameters.user_id,
                  unique_id: customParameters.unique_id,
                  campaignPrompt: customParameters.system_message,
                }),
              },
              first_message: customParameters.first_message,
              language: customParameters.language,
            },
            tts: {
              voice_id: customParameters.voice_id,
            },
          },
        };

        console.log(
          "[ElevenLabs] Sending initial config with prompt:",
          initialConfig.conversation_config_override.agent.prompt.prompt
        );
        console.log(
          "[ElevenLabs] Sending initial config with voice_id:",
          initialConfig.conversation_config_override.tts.voice_id
        );

        // Send the configuration to ElevenLabs
        elevenLabsWs.send(JSON.stringify(initialConfig));
        initialConfigSent = true;
        return true;
      };

      // Handle WebSocket errors
      ws.on("error", (error) => {
        console.error("[Telnyx] WebSocket error:", error);
      });

      // Set up ElevenLabs connection
      const setupElevenLabs = async () => {
        try {
          console.log(
            "[ElevenLabs] Getting signed URL for agent:",
            process.env.ELEVENLABS_AGENT_ID
          );
          const signedUrl = await getSignedUrl(
            process.env.ELEVENLABS_AGENT_ID,
            process.env.ELEVENLABS_API_KEY
          );
          elevenLabsWs = new WebSocket(signedUrl);

          // Start inactivity timeout
          setupInactivityTimeout();

          elevenLabsWs.on("open", () => {
            console.log("[ElevenLabs] Connected to Conversational AI");
            updateActivity();

            // Only send the config if we already have customParameters
            if (customParameters) {
              sendInitialConfig();
            }
            // Otherwise, we'll wait for the 'start' event from Telnyx
          });

          // Process messages from ElevenLabs
          const processElevenLabsMessage = async (data) => {
            try {
              updateActivity(); // Update activity timestamp
              const message = JSON.parse(data);
              const messageType = message.type;

              // Log metadata about message but not full content
              console.log(`[ElevenLabs] Received message type: ${messageType}`);

              switch (messageType) {
                case "conversation_initiation_metadata":
                  console.log(
                    "[ElevenLabs] Received initiation metadata:",
                    message.conversation_initiation_metadata_event
                  );
                  break;

                case "audio":
                  // Check if we have audio content and log the size
                  if (message.audio?.chunk) {
                    const chunkSize = message.audio.chunk.length;
                    console.log(
                      `[ElevenLabs] Received audio chunk: ${chunkSize} bytes`
                    );
                  } else if (message.audio_event?.audio_base_64) {
                    const chunkSize = message.audio_event.audio_base_64.length;
                    console.log(
                      `[ElevenLabs] Received audio event: ${chunkSize} bytes`
                    );
                  } else {
                    console.log(
                      "[ElevenLabs] Received audio message without audio data"
                    );
                  }

                  if (streamSid) {
                    try {
                      // Format audio data consistently regardless of which property contains it
                      let audioBase64 = null;

                      audioBase64 = message.audio_event.audio_base_64;

                      if (audioBase64) {
                        // Ensure the audio is properly formatted for Telnyx
                        const audioData = {
                          event: "media",
                          media: {
                            payload: audioBase64,
                          },
                        };

                        if (ws.readyState === WebSocket.OPEN) {
                          ws.send(JSON.stringify(audioData));
                          console.log(
                            "[ElevenLabs] Sent audio chunk to Telnyx"
                          );
                        } else {
                          console.log(
                            `[ElevenLabs] Cannot send audio: WebSocket state=${ws.readyState}`
                          );
                        }
                      } else {
                        console.log("[ElevenLabs] No audio data to send");
                      }
                    } catch (error) {
                      console.error(
                        "[ElevenLabs] Error processing audio:",
                        error
                      );
                    }
                  } else {
                    console.log(
                      "[ElevenLabs] Received audio but no StreamSid yet"
                    );
                  }
                  break;

                case "interruption":
                  if (streamSid) {
                    console.log("[ElevenLabs] Processing interruption event");
                    ws.send(
                      JSON.stringify({
                        event: "clear",
                        streamSid,
                      })
                    );
                  }
                  break;

                case "ping":
                  if (message.ping_event?.event_id) {
                    elevenLabsWs.send(
                      JSON.stringify({
                        type: "pong",
                        event_id: message.ping_event.event_id,
                      })
                    );
                    console.log("[ElevenLabs] Responded to ping with pong");
                  }
                  break;

                case "agent_response":
                  console.log(
                    `[ElevenLabs] Agent response: ${message.agent_response_event?.agent_response}`
                  );
                  break;

                case "user_transcript":
                  console.log(
                    `[ElevenLabs] User transcript: ${message.user_transcription_event?.user_transcript}`
                  );
                  break;

                case "tool_request":
                  console.log(
                    `[ElevenLabs] Tool request: ${message.tool_request?.tool_name}`
                  );
                  console.log(
                    `[ElevenLabs] Tool request all: ${message.tool_request}`
                  );
                  break;

                case "client_tool_call":
                  //check if the tool_name is schedule_appointment
                  if (
                    message.client_tool_call?.tool_name ===
                    "schedule_appointment"
                  ) {
                    console.log(
                      `[ElevenLabs] Client tool call parameters:`,
                      JSON.stringify(
                        message.client_tool_call?.parameters,
                        null,
                        2
                      )
                    );
                    const response = await bookCalendarEvent(
                      message.client_tool_call?.parameters
                    );
                    if (!response.id) {
                      response.status = "error";
                      response.error = "Failed to book appointment";
                    }
                    console.log(
                      `[Google Calendar] calendar event response: ${response}`
                    );
                    const toolResponse = {
                      type: "client_tool_response",
                      tool_call_id: message.client_tool_call.tool_call_id,
                      data: response,
                    };

                    console.log(
                      `[II] Client tool response payload: ${JSON.stringify(
                        toolResponse
                      )}`
                    );

                    elevenLabsWs.send(JSON.stringify(toolResponse));
                  }

                  break;

                default:
                  console.log(
                    `[ElevenLabs] Unhandled message type: ${messageType}`,
                    message
                  );
              }
              return true;
            } catch (error) {
              console.error("[ElevenLabs] Error processing message:", error);
              return false;
            }
          };

          // Now use this processor in the WebSocket handler
          elevenLabsWs.on("message", processElevenLabsMessage);

          elevenLabsWs.on("error", (error) => {
            console.error("[ElevenLabs] WebSocket error:", error);
          });

          elevenLabsWs.on("close", async () => {
            console.log("[ElevenLabs] Disconnected");
            // Cancel any inactivity timeout
            if (inactivityTimeout) {
              clearTimeout(inactivityTimeout);
              inactivityTimeout = null;
            }

            // Mark that we're closing to prevent duplicate cleanup
            isClosing = true;

            // cleanupCall function to handle hangup and websocket closing
            if (callControlId) {
              await cleanupCall(callControlId, ws, elevenLabsWs);
            } else {
              // Just close the telnyx websocket if no callControlId
              if (ws.readyState === WebSocket.OPEN) {
                ws.close();
              }
            }
          });

          return true;
        } catch (error) {
          console.error("[ElevenLabs] Setup error:", error);
          return false;
        }
      };
      setupElevenLabs();

      // Handle messages from Telnyx
      ws.on("message", async (message) => {
        try {
          // Update activity
          updateActivity();

          const msg = JSON.parse(message);

          if (msg.event !== "media") {
            console.log(`[Telnyx] Received event: ${msg.event}`);
          }

          switch (msg.event) {
            case "start":
              streamSid = msg.stream_id;
              callControlId = msg.start.call_control_id;
              callSid = msg.start.call_session_id;
              customParameters = msg.start.custom_parameters; // Store parameters

              console.log(
                `[Telnyx] Stream started - StreamSid: ${streamSid}, CallSid: ${callSid}`
              );
              console.log("[Telnyx] Start parameters:", customParameters);

              // Now that we have the parameters, send the config if the ElevenLabs connection is open
              if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                sendInitialConfig();
              }
              break;

            case "media":
              if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                try {
                  const audioBase64 = msg.media.payload;
                  const audioMessage = {
                    user_audio_chunk: audioBase64,
                  };
                  elevenLabsWs.send(JSON.stringify(audioMessage));
                  // Debug every 100th chunk to avoid flooding logs
                  if (Math.random() < 0.01) {
                    console.log("[Telnyx] Sent audio chunk to ElevenLabs");
                  }
                } catch (error) {
                  console.error(
                    "[Telnyx] Error sending audio to ElevenLabs:",
                    error
                  );
                }
              }
              break;

            case "stop":
              console.log(`[Telnyx] Stream ${streamSid} ended`);
              // Cancel any inactivity timeout
              if (inactivityTimeout) {
                clearTimeout(inactivityTimeout);
                inactivityTimeout = null;
              }

              // Mark that we're closing to prevent duplicate cleanup
              isClosing = true;

              if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                elevenLabsWs.close();
              }
              break;

            default:
              console.log(`[Telnyx] Unhandled event: ${msg.event}`);
          }
        } catch (error) {
          console.error("[Telnyx] Error processing message:", error);
        }
      });

      ws.on("close", async () => {
        // Cancel any inactivity timeout
        if (inactivityTimeout) {
          clearTimeout(inactivityTimeout);
          inactivityTimeout = null;
        }

        // Mark that we're closing to prevent duplicate cleanup
        if (!isClosing) {
          isClosing = true;

          // Use the cleanupCall function if we have a callControlId
          if (callControlId) {
            await cleanupCall(callControlId, ws, elevenLabsWs);
          } else {
            // Just close the elevenLabs websocket if no callControlId
            if (elevenLabsWs?.readyState === WebSocket.OPEN) {
              elevenLabsWs.close();
            }
          }
        }

        console.log("[Telnyx] Client disconnected");
      });
    }
  );
});

// Generate a unique session ID for tracking
const generateSessionId = () => uuidv4().substring(0, 8);
// Deepgram and groq media stream
fastify.register(async (fastify) => {
  fastify.get(
    "/media-stream-groq-deepgram",
    { websocket: true },
    (connection, req) => {
      const sessionId = generateSessionId();
      let lastActivity = Date.now();
      let isClosing = false;
      let isCallActive = true;
      let sttReady = false;
      let ttsReady = false;
      let audioBuffer = []; // Buffer for audio during initialization

      // Add conversation history array
      let conversationHistory = [{ role: "system", content: SYSTEM_MESSAGE }];

      const logger = {
        info: (message) => console.log(`[${sessionId}] ${message}`),
        error: (message) => console.error(`[${sessionId}] ERROR: ${message}`),
        debug: (message) => console.debug(`[${sessionId}] DEBUG: ${message}`),
      };

      logger.info("New WebSocket connection established");

      const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
      let sttConnection;
      let ttsConnection;
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
          if (sttConnection?.getReadyState() === 1) {
            sttConnection.finish();
            logger.debug("Deepgram STT connection closed");
          }
        } catch (error) {
          logger.error(
            "Error closing Deepgram STT connection: " + error.message
          );
        }

        try {
          if (ttsConnection?.getReadyState() === 1) {
            // Send Close message to properly close the TTS connection
            ttsConnection.send(JSON.stringify({ type: "Close" }));
            ttsReady = false;
            logger.debug("Sent Close message to TTS connection");
          }
        } catch (error) {
          logger.error("Error closing TTS connection: " + error.message);
          ttsReady = false;
        }

        try {
          if (connection.readyState === WebSocket.OPEN) {
            connection.close();
            logger.debug("WebSocket connection closed");
          }
        } catch (error) {
          logger.error("Error closing WebSocket: " + error.message);
        }

        logger.info("Connection fully closed");
      };

      const stopBotResponse = () => {
        if (ttsConnection?.getReadyState() === 1) {
          try {
            // Send Clear to stop pending audio immediately
            ttsConnection.send(JSON.stringify({ type: "Clear" }));
            // ttsConnection.send(JSON.stringify({ type: "Flush" }));
            logger.info("Bot response interrupted");
          } catch (error) {
            logger.error("Error stopping TTS: " + error.message);
          }
        }
      };

      // Add the sendTTSResponse function
      const sendTTSResponse = (text) => {
        if (!text) {
          logger.info("Skipping TTS response as user is speaking.");
          return;
        }

        if (!ttsReady || ttsConnection.getReadyState() !== 1 || !isCallActive) {
          logger.error(
            `Cannot send TTS: ready=${ttsReady}, connection=${ttsConnection?.getReadyState()}, active=${isCallActive}`
          );
          return;
        }

        logger.debug("Sending text to Deepgram TTS");

        try {
          ttsConnection.sendText(text);
          ttsConnection.send(JSON.stringify({ type: "Flush" }));
        } catch (error) {
          logger.error("Error sending TTS:", error);
        }
      };

      // Initialize Deepgram connections with retry logic
      const initSTT = () => {
        try {
          // Initialize both connections in parallel
          const initPromises = [];

          // Initialize TTS connection
          logger.debug("Initializing Deepgram TTS connection");
          ttsConnection = deepgram.speak.live({
            model: "aura-asteria-en",
            voice: "male",
            encoding: "mulaw",
            sample_rate: 8000,
            container: "none",
            volume: 2.0,
          });

          const ttsPromise = new Promise((resolve) => {
            ttsConnection.on(LiveTTSEvents.Open, () => {
              logger.info("Deepgram TTS connection established");
              ttsReady = true;
              resolve();
            });

            // Listen for the Cleared event
            ttsConnection.on(LiveTTSEvents.Clear, (data) => {
              console.log("Buffer cleared successfully", data);
              // Now you can be sure the previous audio generation has stopped
            });

            ttsConnection.on(LiveTTSEvents.Flushed, () => {
              logger.info("TTS stream flushed");
            });
          });
          initPromises.push(ttsPromise);

          // Initialize STT connection
          logger.debug("Initializing Deepgram STT connection");
          sttConnection = deepgram.listen.live({
            model: "nova-2-phonecall",
            language: "en-US",
            smart_format: true,
            encoding: "mulaw",
            sample_rate: 8000,
            channels: 1,
            interim_results: true,
            endpointing: 300,
            utterance_end_ms: 1500,
            punctuate: true,
            vad_events: true,
          });

          const sttPromise = new Promise((resolve) => {
            sttConnection.on(LiveTranscriptionEvents.Open, () => {
              logger.info("Deepgram STT connection established");
              sttReady = true;
              resolve();
            });
          });
          initPromises.push(sttPromise);

          // Wait for both connections to be ready
          Promise.all(initPromises).then(() => {
            logger.info("All Deepgram connections established");

            // Process any buffered audio
            if (audioBuffer.length > 0) {
              logger.debug(
                `Processing ${audioBuffer.length} buffered audio chunks`
              );
              audioBuffer.forEach((chunk) => {
                if (sttConnection.getReadyState() === 1) {
                  sttConnection.send(chunk);
                }
              });
              audioBuffer = [];
            }
          });

          // Set up TTS event handlers
          ttsConnection.on(LiveTTSEvents.Audio, (data) => {
            if (!data || data.length === 0 || !isCallActive) {
              logger.debug(
                "Skipping audio data (empty, interrupted, or call ended)"
              );
              return;
            }

            try {
              const buffer = Buffer.from(data);
              const base64Data = buffer.toString("base64");
              const audioDelta = {
                event: "media",
                media: {
                  payload: base64Data,
                },
              };

              // Only send if not interrupted
              if (connection.readyState === WebSocket.OPEN) {
                connection.send(JSON.stringify(audioDelta));
                logger.debug("Sent TTS audio chunk to Telnyx");
              } else {
                logger.debug("Skipping audio chunk due to interruption");
              }
            } catch (error) {
              logger.error("Error sending TTS:", error);
            }
          });

          ttsConnection.on(LiveTTSEvents.Error, (err) => {
            logger.error("Deepgram TTS error:", err);
          });

          ttsConnection.on(LiveTTSEvents.Close, () => {
            logger.info("Deepgram TTS connection closed");
            ttsReady = false;
          });

          // Handle speech events
          sttConnection.on(LiveTranscriptionEvents.SpeechStarted, () => {
            logger.info("Speech started");
            stopBotResponse();
          });

          sttConnection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
            logger.info("Utterance ended");
          });

          sttConnection.on(LiveTranscriptionEvents.Transcript, async (data) => {
            try {
              resetActivityTimer();
              const text = data.channel.alternatives[0]?.transcript;
              const confidence = data.channel.alternatives[0]?.confidence || 0;

              if (!text?.trim() || confidence < 0.1) {
                logger.debug(
                  `Ignored low quality transcript (${confidence}): "${text}"`
                );
                return;
              }

              if (data.speech_final) {
                logger.info(`Speech final detected: "${text}"`);
                logger.debug("Processing transcript...");
                await processTranscript(text);
              }
            } catch (error) {
              logger.error(`Processing transcript error: ${error.message}`);
              if (error.response) {
                logger.debug(
                  `Deepgram STT API Error Details: ${JSON.stringify(
                    error.response.data
                  )}`
                );
              }
            }
          });

          // Helper function to process complete transcripts
          async function processTranscript(text) {
            if (!text || !isCallActive) {
              logger.debug(
                `Skipping processing: text=${!!text}, callActive=${isCallActive}`
              );
              return;
            }

            logger.info(`Processing transcript: "${text}"`);

            try {
              const groq = new Groq({
                apiKey: process.env.GROQ_API_KEY,
              });

              // Add user's message to history
              conversationHistory.push({ role: "user", content: text });

              // Keep only last 10 messages to prevent context from getting too long
              if (conversationHistory.length > 11) {
                // 1 system message + 10 conversation messages
                conversationHistory = [
                  conversationHistory[0], // Keep system message
                  ...conversationHistory.slice(-10), // Keep last 10 messages
                ];
              }

              logger.debug("Sending to Groq...");
              const llmResponse = await groq.chat.completions.create({
                model: "mixtral-8x7b-32768",
                messages: conversationHistory,
                temperature: 0.7,
                max_completion_tokens: 50,
                top_p: 0.8,
              });

              const responseText = llmResponse.choices[0]?.message?.content;
              if (!responseText) {
                logger.error("Empty response from Groq");
                return;
              }

              // Add assistant's response to history
              conversationHistory.push({
                role: "assistant",
                content: responseText,
              });

              logger.info(`LLM Response: "${responseText}"`);
              logger.debug(
                "Current conversation length: " + conversationHistory.length
              );

              // Check if call is still active before responding
              if (!isCallActive) {
                logger.debug("Call ended, skipping response");
                return;
              }

              // Add a small natural pause before responding
              await new Promise((resolve) => setTimeout(resolve, 300));

              // Send the response using TTS
              sendTTSResponse(responseText);
            } catch (error) {
              logger.error(`Processing error: ${error.message}`);
              if (error.response) {
                logger.debug(
                  `API Error Details: ${JSON.stringify(error.response.data)}`
                );
              }
            }
          }
        } catch (error) {
          logger.error(`Initialization failed: ${error.message}`);
          safeClose();
        }
      };

      // Start the initialization
      initSTT();

      // Handle Telnyx media
      connection.on("message", (message) => {
        try {
          resetActivityTimer();
          const data = JSON.parse(message);

          if (data.event === "media") {
            try {
              const audioChunk = Buffer.from(data.media.payload, "base64");

              if (sttReady) {
                // Send audio directly when ready
                sttConnection.send(audioChunk);
              } else {
                logger.error("Deepgram STT connection not ready");
              }
            } catch (error) {
              logger.error(`Error handling audio: ${error.message}`);
            }
          }
        } catch (error) {
          logger.error(`Message handling error: ${error.message}`);
          safeClose();
        }
      });

      // Handle connection close
      connection.on("close", (code, reason) => {
        logger.info(`WebSocket closed (${code}) - ${reason.toString()}`);
        isCallActive = false; // Mark call as inactive
        safeClose();
      });

      connection.on("error", (error) => {
        logger.error(`WebSocket error: ${error.message}`);
        safeClose();
      });

      // Send periodic keep-alive messages
      const keepAliveInterval = setInterval(() => {
        if (connection.readyState === WebSocket.OPEN) {
          try {
            connection.send(JSON.stringify({ event: "keepalive" }));
            logger.debug("Sent keep-alive message");
          } catch (error) {
            logger.error("Keep-alive failed: " + error.message);
          }
        }
      }, 15000);

      // Cleanup intervals on close
      connection.on("close", () => {
        clearInterval(keepAliveInterval);
      });
    }
  );
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

          // Always remove the number from in_progress_numbers
          const updatedInProgressNumbers = (
            campaign.in_progress_numbers || []
          ).filter((num) => num !== call.to_number);

          // Only remove from numbers_to_call if all attempts are finished
          let updatedNumbersToCall = campaign.numbers_to_call;
          if (allAttemptsFinished) {
            updatedNumbersToCall = campaign.numbers_to_call.filter(
              (num) => num !== call.to_number
            );

            // Update completed/failed counts
            if (numberCalls.some((c) => c.status === "completed")) {
              await campaign.increment("completed_calls");
            } else {
              await campaign.increment("failed_calls");
            }
          }

          // Update campaign with new number lists
          await campaign.update({
            in_progress_numbers: updatedInProgressNumbers,
            numbers_to_call: updatedNumbersToCall,
          });

          console.log(
            `Removed ${call.to_number} from in_progress_numbers. In-progress count: ${updatedInProgressNumbers.length}`
          );

          if (allAttemptsFinished) {
            console.log(
              `Removed ${call.to_number} from numbers_to_call. Remaining: ${updatedNumbersToCall.length}`
            );

            // Check if campaign is completed
            if (
              updatedNumbersToCall.length === 0 &&
              updatedInProgressNumbers.length === 0
            ) {
              console.log(
                `Campaign ${campaign.id} completed - all numbers processed`
              );
              await campaign.update({ status: "completed" });
            } else {
              // Start next batch if there are remaining numbers
              console.log(`Starting next batch for campaign ${campaign.id}`);
              await processCampaignBatch(campaign);
            }
          } else {
            // Still start next batch to process any available numbers
            console.log(
              `Starting next batch for campaign ${campaign.id} (some attempts not finished)`
            );
            await processCampaignBatch(campaign);
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
      console.log("Recording completed", webhookData);
      // Update recording URL
      await call.update({ recording_sid: webhookData.RecordingSid });
      console.log("Call recording URL updated successfully");
    }

    reply.send({ success: true });
  } catch (error) {
    console.error("Error processing webhook:", error);
    reply.code(500).send({ error: "Failed to process webhook" });
  }
});

// WebSocket route for media-stream for real-time-api
fastify.register(async (fastify) => {
  fastify.get(
    "/media-stream-real-time-api",
    { websocket: true },
    (connection, req) => {
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
                payload: Buffer.from(response.delta, "base64").toString(
                  "base64"
                ),
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
    }
  );
});

// Test database connection
try {
  await sequelize.authenticate();
  console.log("Database connection has been established successfully.");

  // Sync database (in development)

  await sequelize.sync({ alter: true });
  console.log("Database synced successfully");
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
