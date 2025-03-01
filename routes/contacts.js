import { Op } from "sequelize";
import Contact from "../models/Contact.js";

async function contactRoutes(fastify, options) {
  // Create a new contact
  fastify.post("/api/contacts", async (request, reply) => {
    try {
      const contact = await Contact.create(request.body);
      return contact;
    } catch (error) {
      console.error("Error creating contact:", error);
      reply.code(500).send({
        error: "Failed to create contact",
        details: error.message,
      });
    }
  });

  // Get all contacts with pagination and search
  fastify.get("/api/contacts", async (request, reply) => {
    try {
      const page = parseInt(request.query.page) || 1;
      const limit = parseInt(request.query.limit) || 10;
      const search = request.query.search || "";
      const offset = (page - 1) * limit;

      const where = {};
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
  fastify.get("/api/contacts/:id", async (request, reply) => {
    try {
      const contact = await Contact.findByPk(request.params.id);
      if (!contact) {
        return reply.code(404).send({ error: "Contact not found" });
      }
      return contact;
    } catch (error) {
      console.error("Error fetching contact:", error);
      reply.code(500).send({
        error: "Failed to fetch contact",
        details: error.message,
      });
    }
  });

  // Update contact
  fastify.put("/api/contacts/:id", async (request, reply) => {
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
  });

  // Delete contact
  fastify.delete("/api/contacts/:id", async (request, reply) => {
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
  });

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
