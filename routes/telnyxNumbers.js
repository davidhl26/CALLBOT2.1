import { Op } from "sequelize";
import TelnyxNumber from "../models/TelnyxNumber.js";

export default async function telnyxNumberRoutes(fastify) {
  // Get all numbers with optional pagination
  fastify.get("/api/telnyx-numbers", async (request, reply) => {
    const { page, limit, search, active } = request.query;
    
    // Build where clause
    const where = {};
    if (search) {
      where.phoneNumber = {
        [Op.iLike]: `%${search}%`,
      };
    }
    if (active !== undefined) {
      where.status = active === 'true' ? 'Active' : 'Inactive';
    }

    // If page and limit are provided, use pagination
    if (page && limit) {
      const offset = (parseInt(page) - 1) * parseInt(limit);
      const { count, rows } = await TelnyxNumber.findAndCountAll({
        where,
        limit: parseInt(limit),
        offset,
        order: [["createdAt", "DESC"]],
      });

      return {
        numbers: rows,
        total: count,
        page: parseInt(page),
        totalPages: Math.ceil(count / parseInt(limit)),
      };
    }

    // If no pagination params, return all numbers
    const numbers = await TelnyxNumber.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });

    return {
      numbers,
      total: numbers.length
    };
  });

  // Get single number
  fastify.get("/api/telnyx-numbers/:id", async (request, reply) => {
    const number = await TelnyxNumber.findByPk(request.params.id);
    if (!number) {
      reply.code(404).send({ error: "Number not found" });
      return;
    }
    return number;
  });

  // Create new number
  fastify.post("/api/telnyx-numbers", async (request, reply) => {
    try {
      const number = await TelnyxNumber.create(request.body);
      reply.code(201).send(number);
    } catch (error) {
      reply.code(400).send({ error: error.message });
    }
  });

  // Update number
  fastify.put("/api/telnyx-numbers/:id", async (request, reply) => {
    const number = await TelnyxNumber.findByPk(request.params.id);
    if (!number) {
      reply.code(404).send({ error: "Number not found" });
      return;
    }

    try {
      await number.update(request.body);
      return number;
    } catch (error) {
      reply.code(400).send({ error: error.message });
    }
  });

  // Delete number
  fastify.delete("/api/telnyx-numbers/:id", async (request, reply) => {
    const number = await TelnyxNumber.findByPk(request.params.id);
    if (!number) {
      reply.code(404).send({ error: "Number not found" });
      return;
    }

    await number.destroy();
    reply.code(204).send();
  });
}
