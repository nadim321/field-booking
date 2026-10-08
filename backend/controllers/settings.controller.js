const settingsService = require('../services/settings.service');
const { POLICY: cancellationPolicy, VERSION: cancellationPolicyVersion } = require('../services/bookings/cancellation-policy');

exports.policy = (req, res) => res.json(cancellationPolicy);

exports.adminSettings = async (req, res) => {
  try {

    res.json({
      advance_payment_percentage: await settingsService.getAdvancePaymentPercentage(),
      turf_name: await settingsService.getSetting('turf_name'),
      turf_address: await settingsService.getSetting('turf_address'),
      turf_phone: await settingsService.getSetting('turf_phone'),
      turf_email: await settingsService.getSetting('turf_email')
    });

  } catch (err) {
    res.fail(err);
  }
};

exports.update = async (req, res) => {

  const {
    advance_payment_percentage,
    turf_name,
    turf_address,
    turf_phone,
    turf_email
  } = req.body;

  try {

    if (advance_payment_percentage !== undefined) {

      const parsed = parseFloat(advance_payment_percentage);

      if (isNaN(parsed) || parsed <= 0 || parsed > 100) {
        return res.status(400).json({
          message: 'advance_payment_percentage must be between 0 and 100'
        });
      }

      await settingsService.setSetting(
        'advance_payment_percentage',
        parsed
      );
    }

    if (turf_name !== undefined)
      await settingsService.setSetting('turf_name', turf_name);

    if (turf_address !== undefined)
      await settingsService.setSetting('turf_address', turf_address);

    if (turf_phone !== undefined)
      await settingsService.setSetting('turf_phone', turf_phone);

    if (turf_email !== undefined)
      await settingsService.setSetting('turf_email', turf_email);

    res.json({
      message: 'Settings updated successfully'
    });

  } catch (err) {

    res.fail(err);

  }

};

exports.publicSettings = async (req, res) => {

  try {

    res.json({
      cancellation_policy: cancellationPolicy,

      turf_name: await settingsService.getSetting('turf_name'),
      turf_address: await settingsService.getSetting('turf_address'),
      turf_phone: await settingsService.getSetting('turf_phone'),
      turf_email: await settingsService.getSetting('turf_email'),

      advance_payment_percentage:
        await settingsService.getAdvancePaymentPercentage()

    });

  } catch (err) {

    res.fail(err);

  }

};
