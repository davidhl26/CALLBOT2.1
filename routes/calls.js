import { authenticate } from "../middleware/auth.js";
import Call from "../models/call.js";
import { getCallRecordingURL } from "../utils/getCallRecordingURL.js";

async function callRoutes(fastify, options) {
  const auth = authenticate(fastify);
  // Get all calls with pagination and sorting
  fastify.get("/api/calls", { preHandler: auth }, async (request, reply) => {
    try {
      const { page, limit } = request.query;

      // If page and limit are provided, use pagination
      if (page && limit) {
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const { count, rows } = await Call.findAndCountAll({
          limit: parseInt(limit),
          offset,
          order: [["createdAt", "DESC"]],
        });

        return {
          calls: rows,
          total: count,
          page: parseInt(page),
          totalPages: Math.ceil(count / parseInt(limit)),
        };
      }

      // If no pagination params, return all calls
      const calls = await Call.findAll({
        order: [["createdAt", "DESC"]],
      });

      return {
        calls,
        total: calls.length,
      };
    } catch (error) {
      console.error("Error fetching calls:", error);
      reply.code(500).send({
        error: "Failed to fetch calls",
        details: error.message,
      });
    }
  });
  //get call recording_url form recording_sid
  fastify.get(
    "/api/calls/:id/get-recording",
    { preHandler: auth },
    async (request, reply) => {
      const { id } = request.params;
      const call = await Call.findByPk(id);
      const recording_url = await getCallRecordingURL(call.recording_sid);
      return recording_url;
    }
  );
}

export default callRoutes;
