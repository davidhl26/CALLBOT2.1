import fastifyCors from "@fastify/cors";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import dotenv from "dotenv";
import Fastify from "fastify";
import fs from "fs";
import telnyx from "telnyx";
import WebSocket from "ws";

// Load environment variables from .env file
dotenv.config();

// Retrieve the OpenAI API key from environment variables. You must have OpenAI Realtime API access.
const { OPENAI_API_KEY, TELNYX_API_KEY } = process.env;
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
fastify.register(fastifyCors, {
  origin: "*", // Update this to your frontend URL in production
});
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Initialize Telnyx client
const telnyxClient = telnyx(TELNYX_API_KEY);

// Constants
const SYSTEM_MESSAGE = fs.readFileSync("systemMessage.md", "utf-8");
const VOICE = "alloy";
const PORT = process.env.PORT || 8000; // Allow dynamic port assignment
const PUBLIC_WS_URL =
  "wss://quality-ultimate-midge.ngrok-free.app/outbound-stream";

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
// <Say> punctuation to improve text-to-speech translation
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

// WebSocket route for inbound media-stream
fastify.register(async (fastify) => {
  fastify.get("/media-stream", { websocket: true }, (connection, req) => {
    console.log(
      `WebSocket connection attempt from: ${
        req.headers["x-forwarded-for"] || req.ip
      }`
    );
    console.log(`Request headers: ${JSON.stringify(req.headers)}`);

    connection.socket.on("error", (error) => {
      console.error("WebSocket error:", error);
    });

    connection.socket.on("close", (code, reason) => {
      console.log(`WebSocket closed: ${code} - ${reason}`);
    });

    console.log("Client connected=========");

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

// New outbound media stream handler
// WebSocket route for outbound-stream
fastify.register(async (fastify) => {
  fastify.get("/outbound-stream", { websocket: true }, (connection, req) => {
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

        if (
          response.type === "response.done" &&
          response.response?.status === "failed"
        ) {
          console.error(
            "OpenAI Response Failed:",
            response.response.status_details.error
          );
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

// Add call event webhook handler
// Updated event handler
fastify.post("/call-events", async (request, reply) => {
  try {
    const event = request.body;

    if (event.data.event_type === "call.answered") {
      console.log(
        "Starting media stream for call:",
        event.data.payload.call_control_id
      );

      try {
        await telnyxClient.calls.streamingStart({
          call_control_id: event.data.payload.call_control_id,
          stream_url: PUBLIC_WS_URL,
          // bidirectionalMode: "rtp",
        });
        console.log("Media stream initiated successfully");
      } catch (streamError) {
        console.error(
          "Stream start failed:",
          streamError.response?.data || streamError.message
        );
        throw streamError;
      }
    }

    reply.send({ status: "handled" });
  } catch (error) {
    console.error("Call event handling error:", error);
    reply.status(500).send({ error: "Event processing failed" });
  }
});

// Add Telnyx call initiation endpoint
console.log("Connection ID:", process.env.TELNYX_CONNECTION_ID?.length === 19);
fastify.post("/initiate-call", async (request, reply) => {
  try {
    const { to_number, system_message } = request.body;

    // Validate input
    if (!to_number?.match(/^\+[1-9]\d{1,14}$/)) {
      return reply.code(400).send({ error: "Invalid E.164 phone number" });
    }

    // Initiate Telnyx call
    const response = await telnyxClient.calls.create({
      connection_id: "2633356879509587644", // REPLACE WITH ACTUAL ID
      to: to_number,
      from: "+14102753864", // Your Telnyx number
      webhook_url: `${process.env.PUBLIC_SERVER_URL}/call-events`,
    });

    return {
      success: true,
      call_id: response.data.id,
      status: response.data.status,
    };
  } catch (error) {
    // In the catch block:
    console.error("Telnyx API error details:", error.raw?.errors);
    reply.code(500).send({
      error: "Call initiation failed",
      details: error.message,
    });
  }
});

fastify.listen({ port: PORT }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server is listening on port ${PORT}`);
});
