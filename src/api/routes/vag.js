const express = require('express');
const vagController = require('../controllers/vag');

module.exports = (context) => {
  let router = express.Router();
  router.get('/devices', vagController.getSessions.bind(context));
  router.get('/devices/:device/:channel/realplay/:action/:host/:port/:mode', vagController.getSession.bind(context));
  return router;
};