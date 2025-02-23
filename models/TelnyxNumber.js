import { DataTypes } from 'sequelize';
import sequelize from '../config/sequelize.js';

const TelnyxNumber = sequelize.define('TelnyxNumber', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  phoneNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true
    }
  },
  type: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'Geographic'
  },
  region: {
    type: DataTypes.STRING,
    allowNull: true
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'Active'
  },
  assignment: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  timestamps: true
});

export default TelnyxNumber;
