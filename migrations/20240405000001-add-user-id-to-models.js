"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add user_id to Campaigns
    await queryInterface.addColumn("Campaigns", "user_id", {
      type: Sequelize.INTEGER,
      allowNull: true, // Initially set as true to allow migration of existing data
      references: {
        model: "Users",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    // Add user_id to Contacts
    await queryInterface.addColumn("Contacts", "user_id", {
      type: Sequelize.INTEGER,
      allowNull: true, // Initially set as true to allow migration of existing data
      references: {
        model: "Users",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    // Add user_id to TelnyxNumbers
    await queryInterface.addColumn("TelnyxNumbers", "user_id", {
      type: Sequelize.INTEGER,
      allowNull: true, // Initially set as true to allow migration of existing data
      references: {
        model: "Users",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    // After all data is migrated, you can change allowNull to false using another migration
  },

  async down(queryInterface, Sequelize) {
    // Remove user_id from Campaigns
    await queryInterface.removeColumn("Campaigns", "user_id");

    // Remove user_id from Contacts
    await queryInterface.removeColumn("Contacts", "user_id");

    // Remove user_id from TelnyxNumbers
    await queryInterface.removeColumn("TelnyxNumbers", "user_id");
  },
};
