export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable('TelnyxNumbers', {
    id: {
      type: Sequelize.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true
    },
    phoneNumber: {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true
    },
    type: {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'Geographic'
    },
    region: {
      type: Sequelize.STRING,
      allowNull: true
    },
    status: {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'Active'
    },
    assignment: {
      type: Sequelize.STRING,
      allowNull: true
    },
    createdAt: {
      type: Sequelize.DATE,
      allowNull: false
    },
    updatedAt: {
      type: Sequelize.DATE,
      allowNull: false
    }
  });
}

export async function down(queryInterface, Sequelize) {
  await queryInterface.dropTable('TelnyxNumbers');
}
