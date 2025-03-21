import Call from "../models/call.js";

async function callRoutes(fastify, options) {
  // Get all calls with pagination and sorting
  fastify.get("/api/calls", async (request, reply) => {
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
}

export default callRoutes;
