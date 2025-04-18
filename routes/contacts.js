import { Op } from "sequelize";
import { authenticate } from "../middleware/auth.js";
import Contact from "../models/Contact.js";

async function contactRoutes(fastify, options) {
  const auth = authenticate(fastify);
  // Create a new contact
  fastify.post(
    "/api/contacts",
    { preHandler: auth },
    async (request, reply) => {
      try {
        if (!request.body.user_id) {
          return reply.code(400).send({ error: "User ID is required" });
        }

        const contact = await Contact.create(request.body);
        return contact;
      } catch (error) {
        console.error("Error creating contact:", error);
        reply.code(500).send({
          error: "Failed to create contact",
          details: error.message,
        });
      }
    }
  );

  // Get all contacts with pagination and search
  fastify.get("/api/contacts", { preHandler: auth }, async (request, reply) => {
    try {
      const page = parseInt(request.query.page) || 1;
      const limit = parseInt(request.query.limit) || 10;
      const search = request.query.search || "";
      const user_id = request.query.user_id;
      const offset = (page - 1) * limit;

      if (!user_id) {
        return reply.code(400).send({ error: "User ID is required" });
      }

      const where = { user_id };
      if (search) {
        where[Op.or] = [
          { firstName: { [Op.iLike]: `%${search}%` } },
          { lastName: { [Op.iLike]: `%${search}%` } },
          { phoneNumber: { [Op.iLike]: `%${search}%` } },
          { email: { [Op.iLike]: `%${search}%` } },
          { company: { [Op.iLike]: `%${search}%` } },
        ];
      }

      const { count, rows } = await Contact.findAndCountAll({
        where,
        order: [["createdAt", "DESC"]],
        limit,
        offset,
      });

      return {
        contacts: rows,
        total: count,
        page: page,
        totalPages: Math.ceil(count / limit),
      };
    } catch (error) {
      console.error("Error listing contacts:", error);
      reply.code(500).send({
        error: "Failed to list contacts",
        details: error.message,
      });
    }
  });

  // Get single contact
  fastify.get(
    "/api/contacts/:id",
    { preHandler: auth },
    async (request, reply) => {
      try {
        const user_id = request.query.user_id;

        if (!user_id) {
          return reply.code(400).send({ error: "User ID is required" });
        }

        const contact = await Contact.findOne({
          where: {
            id: request.params.id,
            user_id: user_id,
          },
        });

        if (!contact) {
          return reply
            .code(404)
            .send({ error: "Contact not found or unauthorized access" });
        }

        return contact;
      } catch (error) {
        console.error("Error fetching contact:", error);
        reply.code(500).send({
          error: "Failed to fetch contact",
          details: error.message,
        });
      }
    }
  );

  // Update contact
  fastify.put(
    "/api/contacts/:id",
    { preHandler: auth },
    async (request, reply) => {
      try {
        const contact = await Contact.findByPk(request.params.id);
        if (!contact) {
          return reply.code(404).send({ error: "Contact not found" });
        }

        await contact.update(request.body);
        return contact;
      } catch (error) {
        console.error("Error updating contact:", error);
        reply.code(500).send({
          error: "Failed to update contact",
          details: error.message,
        });
      }
    }
  );

  // Delete contact
  fastify.delete(
    "/api/contacts/:id",
    { preHandler: auth },
    async (request, reply) => {
      try {
        const contact = await Contact.findByPk(request.params.id);
        if (!contact) {
          return reply.code(404).send({ error: "Contact not found" });
        }

        await contact.destroy();
        return { message: "Contact deleted successfully" };
      } catch (error) {
        console.error("Error deleting contact:", error);
        reply.code(500).send({
          error: "Failed to delete contact",
          details: error.message,
        });
      }
    }
  );

  // Bulk create contacts
  fastify.post("/api/contacts/bulk", async (request, reply) => {
    try {
      const contacts = await Contact.bulkCreate(request.body.contacts);
      return contacts;
    } catch (error) {
      console.error("Error bulk creating contacts:", error);
      reply.code(500).send({
        error: "Failed to bulk create contacts",
        details: error.message,
      });
    }
  });
}

export default contactRoutes;
