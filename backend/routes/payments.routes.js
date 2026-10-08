const router = require('express').Router();
const controller = require('../controllers/payments.controller');
const asyncHandler = require('../middleware/async-handler');
const express = require('express');

router.post('/api/payments/initiate', asyncHandler(controller.initiate));
router.post('/api/payments/ipn', express.urlencoded({ extended: true }), asyncHandler(controller.ipn));
router.post('/api/payments/success', express.urlencoded({ extended: true }), asyncHandler(controller.success));
router.post('/api/payments/fail', express.urlencoded({ extended: true }), asyncHandler(controller.fail));
router.post('/api/payments/cancel', express.urlencoded({ extended: true }), asyncHandler(controller.cancel));

module.exports = router;
