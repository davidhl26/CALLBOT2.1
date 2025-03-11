import { createClient } from "@deepgram/sdk";
import fastifyWebsocket from "@fastify/websocket";
import axios from "axios";
import dotenv from "dotenv";
import Fastify from "fastify";

dotenv.config();

const fastify = Fastify({ logger: true });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// Configuration
const services = {
  sttOptions: { model: "nova-2", punctuate: true, endpointing: 300 },
  ttsOptions: {
    model: "aura-asteria-en",
    url: "https://api.deepgram.com/v1/speak",
  },
  groqOptions: {
    url: "https://api.groq.com/v1/chat/completions",
    model: "mixtral-8x7b-32768",
  },
};

// Initialize WebSocket
fastify.register(fastifyWebsocket);

// Session management using closure
const createCallSession = (telnyxWs) => {
  let sttConnection = null;
  const conversationHistory = [];

  // STT initialization
  const initializeSTT = async () => {
    sttConnection = deepgram.listen.live(services.sttOptions);

    sttConnection.addListener("transcriptReceived", (transcript) =>
      handleTranscript(transcript, telnyxWs, conversationHistory)
    );

    telnyxWs.on("message", (audio) => sttConnection.send(audio));
    telnyxWs.on("close", () => sttConnection.finish());
  };

  return { initializeSTT };
};

// Transcript handler
const handleTranscript = async (transcript, telnyxWs, history) => {
  const text = transcript.channel.alternatives[0].transcript;
  if (!text) return;

  try {
    const llmResponse = await processWithGroq(text, history);
    const audio = await generateTTS(llmResponse);
    telnyxWs.send(audio);
  } catch (error) {
    fastify.log.error("Processing error:", error);
  }
};

// Groq processing
const processWithGroq = async (text, history) => {
  const messages = [
    { role: "system", content: process.env.SYSTEM_PROMPT },
    ...history.slice(-6), // Keep last 3 exchanges
    { role: "user", content: text },
  ];

  const { data } = await axios.post(
    services.groqOptions.url,
    {
      model: services.groqOptions.model,
      messages,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  const responseText = data.choices[0].message.content;
  history.push(
    { role: "user", content: text },
    { role: "assistant", content: responseText }
  );

  return responseText;
};

// TTS generation
const generateTTS = async (text) => {
  const { data } = await axios.post(
    services.ttsOptions.url,
    { text },
    {
      params: { model: services.ttsOptions.model },
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        "Content-Type": "application/json",
      },
      responseType: "arraybuffer",
    }
  );

  return Buffer.from(data);
};

// WebSocket endpoint handler
fastify.register(async (instance) => {
  instance.get("/media-stream", { websocket: true }, (connection) => {
    const { initializeSTT } = createCallSession(connection.socket);

    initializeSTT().catch((error) => {
      fastify.log.error("STT initialization failed:", error);
      connection.socket.close();
    });
  });
});

// Server startup
fastify.listen({ port: process.env.PORT || 3000 }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
