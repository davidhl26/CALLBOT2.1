import sequelize from "../config/sequelize.js";
import Call from "./call.js";
import Campaign from "./campaign.js";
import Contact from "./Contact.js";
import TelnyxNumber from "./TelnyxNumber.js";
import User from "./user.js";

// Define associations
Call.belongsTo(Contact, {
  foreignKey: "contact_id",
  as: "contact",
});

Contact.hasMany(Call, {
  foreignKey: "contact_id",
  as: "calls",
});

// User associations
User.hasMany(Campaign, {
  foreignKey: "user_id",
  as: "campaigns",
});

User.hasMany(Contact, {
  foreignKey: "user_id",
  as: "contacts",
});

User.hasMany(TelnyxNumber, {
  foreignKey: "user_id",
  as: "telnyxNumbers",
});

// Reverse associations
Campaign.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

Contact.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

TelnyxNumber.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

const db = {
  sequelize,
  Call,
  Contact,
  Campaign,
  TelnyxNumber,
  User,
};

export default db;
