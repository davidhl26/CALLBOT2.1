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
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pending", "in_progress", "paused", "completed"),
      defaultValue: "pending",
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
  },
  {
    timestamps: true,
  }
);

export default Campaign;
