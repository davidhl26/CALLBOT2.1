import Call from "../models/call.js";

export default function webhookRoutes(fastify) {
  fastify.post("/intent", async (request, reply) => {
    console.log("Intent webhook received:", request.body);
    if (request.body.intent) {
      const call = await Call.findOne({
        where: { unique_id: request.body.unique_id },
      });
      call.intent = request.body.intent;
      call.note = request.body.note;
      await call.save();
      reply.send({
        success: true,
        message: "Intent received",
      });
    } else {
      reply.send({
        success: false,
        message: "Intent not received",
      });
    }
  });
}
