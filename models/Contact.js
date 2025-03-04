import { DataTypes } from "sequelize";
import sequelize from "../config/sequelize.js";

const Contact = sequelize.define(
  "Contact",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: true,
      },
    },
    firstName: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    lastName: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    gender: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "Mr",
      validate: {
        isIn: [["Mr", "Mrs"]],
      },
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,

      validate: {
        isEmail: true,
      },
    },
    company: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "Active",
    },
    tags: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: [],
    },
  },
  {
    timestamps: true,
    modelName: "Contact",
    tableName: "Contacts",
  }
);

export default Contact;
