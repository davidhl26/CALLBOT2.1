import dotenv from "dotenv";
import express from "express";
import expressWs from "express-ws";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import twilio from "twilio";
import { fileURLToPath } from "url";
import WebSocket from "ws";

// Get the directory name of the current module
const __dirname = dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env file
dotenv.config();

// Retrieve the OpenAI API key from environment variables.
const { OPENAI_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;

if (!OPENAI_API_KEY) {
  console.error("Missing OpenAI API key. Please set it in the .env file.");
  process.exit(1);
}

// Initialize Express
const app = express();

// Add body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

expressWs(app);

// Initialize Twilio client
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Load system prompt from markdown file
const SYSTEM_MESSAGE = readFileSync(
  join(__dirname, "prompts", "system.md"),
  "utf-8"
);
const VOICE = "alloy";
const PORT = process.env.PORT || 5050;

// List of Event Types to log to the console
const LOG_EVENT_TYPES = [
  "error",
  "response.content.done",
  "rate_limits.updated",
  "response.done",
  "input_audio_buffer.committed",
  "input_audio_buffer.speech_stopped",
  "input_audio_buffer.speech_started",
  "session.created",
];

// Show AI response elapsed timing calculations
const SHOW_TIMING_MATH = false;

// Root Route
app.get("/", (req, res) => {
  res.json({ message: "Twilio Media Stream Server is running!" });
});

// Route for Twilio to handle incoming calls
app.all("/incoming-call", (req, res) => {
  console.log("Incoming call received. Request body:", req.body);
  console.log("Request headers:", req.headers);

  // Store the Call SID in the session
  const callSid = req.body.CallSid;
  console.log("Call SID:", callSid);

  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Say>Please wait while we connect your call to the A.I. voice assistant, powered by AJ Fahim and David.</Say>
                              <Pause length="1"/>
                              <Say>O.K. you can start talking!</Say>
                              <Connect>
                                  <Stream url="wss://${req.headers.host}/media-stream" callSid="${callSid}" />
                              </Connect>
                          </Response>`;

  console.log(
    "Sending TwiML response with Stream URL:",
    `wss://${req.headers.host}/media-stream`
  );
  res.type("text/xml").send(twimlResponse);
});

// WebSocket route for media-stream
app.ws("/media-stream", (ws, req) => {
  console.log("WebSocket connection attempt received");

  // Connection-specific state
  let streamSid = null;
  let callSid = null;
  let latestMediaTimestamp = 0;
  let lastAssistantItem = null;
  let markQueue = [];
  let responseStartTimestampTwilio = null;
  let lastUserInteractionTime = Date.now();
  const INTERACTION_TIMEOUT = 30000; // 30 seconds

  const openAiWs = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01",
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  // Control initial session with OpenAI
  const initializeSession = () => {
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

  // Send initial conversation item if AI talks first
  const sendInitialConversationItem = () => {
    const initialConversationItem = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: 'Greet the user with "Hello there! I am an AI voice assistant created by AJ Fahim as part of a project with David. You can ask me for facts, jokes, or anything you can imagine. How can I help you?"',
          },
        ],
      },
    };

    if (SHOW_TIMING_MATH)
      console.log(
        "Sending initial conversation item:",
        JSON.stringify(initialConversationItem)
      );
    openAiWs.send(JSON.stringify(initialConversationItem));
    openAiWs.send(JSON.stringify({ type: "response.create" }));
  };

  // Handle interruption when the caller's speech starts
  const handleSpeechStartedEvent = () => {
    if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
      const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
      if (SHOW_TIMING_MATH)
        console.log(
          `Calculating elapsed time for truncation: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`
        );

      if (lastAssistantItem) {
        const truncateEvent = {
          type: "conversation.item.truncate",
          item_id: lastAssistantItem,
          content_index: 0,
          audio_end_ms: elapsedTime,
        };
        if (SHOW_TIMING_MATH)
          console.log(
            "Sending truncation event:",
            JSON.stringify(truncateEvent)
          );
        openAiWs.send(JSON.stringify(truncateEvent));
      }

      ws.send(
        JSON.stringify({
          event: "clear",
          streamSid: streamSid,
        })
      );

      // Reset
      markQueue = [];
      lastAssistantItem = null;
      responseStartTimestampTwilio = null;
    }
  };

  // Send mark messages to Media Streams
  const sendMark = (connection, streamSid) => {
    if (streamSid) {
      const markEvent = {
        event: "mark",
        streamSid: streamSid,
        mark: { name: "responsePart" },
      };
      connection.send(JSON.stringify(markEvent));
      markQueue.push("responsePart");
    }
  };

  // Check for conversation timeout
  const checkConversationTimeout = setInterval(() => {
    const timeSinceLastInteraction = Date.now() - lastUserInteractionTime;
    if (timeSinceLastInteraction > INTERACTION_TIMEOUT && callSid) {
      console.log("Conversation timeout detected");
      endCall(callSid);
      clearInterval(checkConversationTimeout);
    }
  }, 5000);

  // Open event for OpenAI WebSocket
  openAiWs.on("open", () => {
    console.log("Connected to the OpenAI Realtime API");
    initializeSession();
    setTimeout(() => {
      sendInitialConversationItem();
    }, 1000); // Add a small delay to ensure session is initialized
  });

  openAiWs.on("error", (error) => {
    console.error("OpenAI WebSocket error:", error);
  });

  openAiWs.on("close", (code, reason) => {
    console.log("OpenAI WebSocket closed:", code, reason);
    clearInterval(checkConversationTimeout);
  });

  // Listen for messages from the OpenAI WebSocket
  openAiWs.on("message", async (data) => {
    try {
      const response = JSON.parse(data);

      // Log all message types and their content
      console.log("\n=== OpenAI Message Received ===");
      console.log("Message Type:", response.type);
      console.log("Full Message:", JSON.stringify(response, null, 2));

      const handleOpenAIMessage = (message) => {
        console.log("\n=== OpenAI Message Received ===");
        console.log("Message Type:", message.type);
        console.log("Full Message:", JSON.stringify(message, null, 2));

        if (message.type === "conversation.item.created" && message.item.role === "assistant") {
          // Process assistant's response
          const content = message.item.content;
          if (content && content.length > 0) {
            const text = content[0].text;
            if (text) {
              console.log("Assistant's response text:", text);
            }
          }
        }
      };

      handleOpenAIMessage(response);

      // Continue with audio processing
      if (response.type === "response.audio.delta" && response.delta) {
        const audioDelta = {
          event: "media",
          streamSid: streamSid,
          media: { payload: response.delta },
        };
        ws.send(JSON.stringify(audioDelta));

        if (!responseStartTimestampTwilio) {
          responseStartTimestampTwilio = latestMediaTimestamp;
          if (SHOW_TIMING_MATH)
            console.log(
              `Setting start timestamp for new response: ${responseStartTimestampTwilio}ms`
            );
        }

        if (response.item_id) {
          lastAssistantItem = response.item_id;
        }

        sendMark(ws, streamSid);
      }

      if (response.type === "input_audio_buffer.speech_started") {
        handleSpeechStartedEvent();
      }
    } catch (error) {
      console.error("Error processing OpenAI message:", error);
      console.error("Raw message:", data);
    }
  });

  // Handle WebSocket messages from Twilio
  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.event === "start") {
        streamSid = data.streamSid;
        callSid = data.start.customParameters.callSid;
        console.log("Media WS: Received start event");
        console.log("Stream SID:", streamSid);
        console.log("Call SID:", callSid);
        // Reset start and media timestamp on a new stream
        responseStartTimestampTwilio = null;
        latestMediaTimestamp = 0;
      }

      if (data.event === "media") {
        latestMediaTimestamp = data.media.timestamp;
        lastUserInteractionTime = Date.now(); // Update last interaction time
        if (openAiWs.readyState === WebSocket.OPEN) {
          const audioAppend = {
            type: "input_audio_buffer.append",
            audio: data.media.payload,
          };
          openAiWs.send(JSON.stringify(audioAppend));
        }
      }

      if (data.event === "mark" && data.mark.name === "responsePart") {
        if (markQueue.length > 0) {
          markQueue.shift();
        }
      }
    } catch (error) {
      console.error("Error processing Twilio message:", error);
    }
  });

  // Handle WebSocket close
  ws.on("close", () => {
    console.log("Client disconnected");
    clearInterval(checkConversationTimeout);
    if (openAiWs.readyState === WebSocket.OPEN) {
      openAiWs.close();
    }
  });
});

// Function to end the call using Twilio API
const endCall = async (callSid) => {
  try {
    console.log("\n=== Attempting to End Call ===");
    console.log("Call SID:", callSid);
    await twilioClient.calls(callSid).update({ status: "completed" });
    console.log(`Call ${callSid} ended successfully`);
  } catch (error) {
    console.error("Error ending call:", error);
  }
};

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
