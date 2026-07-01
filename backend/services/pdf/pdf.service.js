const PDFDocument = require('pdfkit');

/**
 * Generates a clean, professional booking slip PDF.
 * Returns a Promise that resolves to a Buffer.
 * 
 * @param {object} booking Booking data including slot times
 * @returns {Promise<Buffer>}
 */
function generateBookingSlipPDF(booking) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A6', margin: 25 });
      const buffers = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      // Brand Color
      const primaryColor = '#10b981'; // Emerald Green
      const textColor = '#1e293b'; // Slate 800
      const mutedColor = '#64748b'; // Slate 500

      // Header Banner
      doc.rect(0, 0, doc.page.width, 10)
         .fill(primaryColor);

      // Title & Branding
      doc.fillColor(primaryColor)
         .font('Helvetica-Bold')
         .fontSize(16)
         .text('KICKOFF ARENA', 25, 25);

      doc.fillColor(textColor)
         .fontSize(9)
         .font('Helvetica')
         .text('Premium Football Turf Booking Slip', 25, 43);

      // Divider Line
      doc.moveTo(25, 58)
         .lineTo(doc.page.width - 25, 58)
         .strokeColor('#cbd5e1')
         .lineWidth(1)
         .stroke();

      // Booking ID and Date
      doc.fillColor(textColor)
         .font('Helvetica-Bold')
         .fontSize(8)
         .text(`BOOKING REF: #${booking.id || booking.booking_id || 'N/A'}`, 25, 68);

      const createdDate = booking.created_at 
        ? new Date(booking.created_at).toLocaleDateString('en-US', { dateStyle: 'medium' }) 
        : new Date().toLocaleDateString('en-US', { dateStyle: 'medium' });
      
      doc.font('Helvetica')
         .fillColor(mutedColor)
         .text(`Issued: ${createdDate}`, doc.page.width - 120, 68, { width: 95, align: 'right' });

      // Customer Information Panel
      doc.rect(25, 83, doc.page.width - 50, 42)
         .fill('#f8fafc')
         .strokeColor('#e2e8f0')
         .lineWidth(0.5)
         .stroke();

      doc.fillColor(textColor)
         .font('Helvetica-Bold')
         .fontSize(8)
         .text('CUSTOMER INFORMATION', 32, 90);

      doc.font('Helvetica')
         .fontSize(8)
         .fillColor(textColor)
         .text(`Name: ${booking.customer_name}`, 32, 102)
         .text(`Phone: ${booking.customer_phone}`, 32, 112);

      if (booking.team_name) {
        doc.text(`Team: ${booking.team_name}`, doc.page.width / 2 + 10, 102);
      }
      if (booking.customer_email) {
        doc.text(`Email: ${booking.customer_email}`, doc.page.width / 2 + 10, 112);
      }

      // Slot Details Panel
      doc.rect(25, 133, doc.page.width - 50, 42)
         .fill('#f8fafc')
         .strokeColor('#e2e8f0')
         .lineWidth(0.5)
         .stroke();

      doc.fillColor(textColor)
         .font('Helvetica-Bold')
         .fontSize(8)
         .text('SCHEDULE & TIMING', 32, 140);

      // Playing Date formatted nicely
      const playDate = booking.booking_date
        ? new Date(booking.booking_date).toLocaleDateString('en-US', { dateStyle: 'long' })
        : 'N/A';

      doc.font('Helvetica')
         .fontSize(8)
         .fillColor(textColor)
         .text(`Date: ${playDate}`, 32, 152)
         .text(`Time Slot: ${booking.start_time || 'N/A'} - ${booking.end_time || 'N/A'}`, 32, 162);

      // Payment Summary Panel
      doc.rect(25, 183, doc.page.width - 50, 72)
         .fill('#f8fafc')
         .strokeColor('#e2e8f0')
         .lineWidth(0.5)
         .stroke();

      doc.fillColor(textColor)
         .font('Helvetica-Bold')
         .fontSize(8)
         .text('PAYMENT SUMMARY', 32, 190);

      // Calculate balance due
      const price = parseFloat(booking.price || 0);
      const paid = parseFloat(booking.amount_paid || 0);
      const due = Math.max(0, price - paid);

      doc.font('Helvetica')
         .fontSize(8)
         .fillColor(textColor)
         .text(`Total Charge:`, 32, 203)
         .text(`Amount Paid:`, 32, 213)
         .text(`Balance Due:`, 32, 223)
         .text(`Payment Status:`, 32, 233);

      doc.font('Helvetica-Bold')
         .text(`BDT ${price.toFixed(2)}`, 110, 203)
         .text(`BDT ${paid.toFixed(2)}`, 110, 213)
         .fillColor(due > 0 ? '#f59e0b' : '#10b981')
         .text(`BDT ${due.toFixed(2)}`, 110, 223);

      const statusText = (booking.payment_status || 'unpaid').toUpperCase();
      doc.fillColor(statusText === 'PAID' ? '#10b981' : '#f59e0b')
         .text(statusText, 110, 233);

      // Payment method details if exists
      if (booking.payment_method || booking.transaction_id) {
        doc.font('Helvetica')
           .fontSize(7)
           .fillColor(mutedColor);

        let detailsStr = '';
        if (booking.payment_method) detailsStr += `Method: ${booking.payment_method}`;
        if (booking.transaction_id) detailsStr += ` | Txn ID: ${booking.transaction_id}`;
        doc.text(detailsStr, 32, 245, { width: doc.page.width - 64 });
      }

      // Rules / Footer
      doc.fillColor(mutedColor)
         .font('Helvetica')
         .fontSize(6.5)
         .text('IMPORTANT INSTRUCTIONS:', 25, 265);

      doc.fontSize(6)
         .text('1. Please arrive at least 10 minutes prior to your booking start time.', 25, 274)
         .text('2. Only turf or indoor flats shoes are permitted. Spikes/studs are strictly prohibited.', 25, 282)
         .text('3. Respect the schedule. Extensions are subject to slot availability.', 25, 290)
         .text('4. Booking is subject to our terms of service and turf policy.', 25, 298);

      // Center Thank You note
      doc.fillColor(primaryColor)
         .font('Helvetica-Bold')
         .fontSize(8)
         .text('THANK YOU FOR PLAYING!', 25, 315, { align: 'center', width: doc.page.width - 50 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateBookingSlipPDF
};
