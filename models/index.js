import sequelize from "../config/sequelize.js";
import Call from "./call.js";
import Contact from "./Contact.js";
import Campaign from "./campaign.js";

// Define associations
Call.belongsTo(Contact, {
  foreignKey: "contact_id",
  as: "contact",
});

Contact.hasMany(Call, {
  foreignKey: "contact_id",
  as: "calls",
});

const db = {
  sequelize,
  Call,
  Contact,
  Campaign,
};

export default db;
