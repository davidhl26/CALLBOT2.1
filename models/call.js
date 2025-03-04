import { DataTypes } from "sequelize";
import sequelize from "../config/sequelize.js";

const Call = sequelize.define(
  "Call",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    call_sid: {
      type: DataTypes.STRING,
      unique: true,
    },
    from_number: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    to_number: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING,
      defaultValue: "queued",
    },
    start_time: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    end_time: {
      type: DataTypes.DATE,
    },
    duration: {
      type: DataTypes.INTEGER,
    },
    cost: {
      type: DataTypes.DECIMAL(10, 4),
    },
    system_message: {
      type: DataTypes.TEXT,
    },
    recording_url: {
      type: DataTypes.TEXT,
    },
    campaign_id: {
      type: DataTypes.INTEGER,
      references: {
        model: "Campaigns",
        key: "id",
      },
    },
    contact_id: {
      type: DataTypes.UUID,
      references: {
        model: "Contacts",
        key: "id",
      },
    },
  },
  {
    timestamps: true,
    modelName: "Call",
    tableName: "Calls",
  }
);

export default Call;
