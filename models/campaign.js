import { DataTypes } from "sequelize";
import sequelize from "../config/sequelize.js";

const Campaign = sequelize.define(
  "Campaign",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Users",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pending", "in_progress", "paused", "completed"),
      defaultValue: "pending",
    },
    ai_provider: {
      type: DataTypes.STRING,
      defaultValue: "eleven_labs",
      validate: {
        isIn: {
          args: [["eleven_labs", "real-time-api", "groq+deepgram"]],
          msg: "ai_provider must be one of: eleven_labs, real-time-api, groq+deepgram",
        },
      },
    },
    first_message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    voice: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    voice_id: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    language: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    last_status: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    all_numbers: {
      type: DataTypes.JSON,
      defaultValue: [],
      allowNull: false,
      comment: "All phone numbers initially added to this campaign",
    },
    numbers_to_call: {
      type: DataTypes.JSON,
      defaultValue: [],
      allowNull: false,
      comment: "Numbers that still need to be called or retried",
    },
    telnyx_numbers: {
      type: DataTypes.JSON,
      defaultValue: [],
      allowNull: false,
    },
    system_message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    completed_calls: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: "Number of unique numbers that have been successfully called",
    },
    failed_calls: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: "Number of unique numbers that failed or were not answered",
    },
    total_duration: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: "Total duration of all calls in seconds",
    },
    total_cost: {
      type: DataTypes.DECIMAL(10, 4),
      defaultValue: 0,
      comment: "Total cost of all calls",
    },
    total_calls: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: "Total number of calls in this campaign",
    },
  },
  {
    timestamps: true,
  }
);

export default Campaign;
