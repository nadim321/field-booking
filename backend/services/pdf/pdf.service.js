const PDFDocument = require('pdfkit');
const settingsService = require('../settings.service');

const PRIMARY = '#10b981';
const TEXT = '#1e293b';
const MUTED = '#64748b';
const BORDER = '#e2e8f0';
const BG = '#f8fafc';

function money(value) {
   return `BDT ${Number(value || 0).toFixed(2)}`;
}

function drawCard(doc, title) {

   const startY = doc.y;

   doc.font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(TEXT)
      .text(title, 35, startY + 8);

   doc.y = startY + 22;

   return startY;
}

function finishCard(doc, startY) {

   const endY = doc.y + 3;

   doc.save();

   doc.roundedRect(
      25,
      startY,
      doc.page.width - 50,
      endY - startY,
      5
   );

   // Draw only border
   doc.strokeColor(BORDER)
      .lineWidth(1)
      .stroke();

   doc.restore();

   doc.moveDown(.3);
}

function row(doc, label, value, color = TEXT) {

   const startY = doc.y;

   const labelHeight = doc.heightOfString(label, {
      width: 75
   });

   const valueHeight = doc.heightOfString(value || '-', {
      width: doc.page.width - 150
   });

   const rowHeight = Math.max(labelHeight, valueHeight);

   doc.fillColor(TEXT)
      .font('Helvetica')
      .fontSize(8)
      .text(label, 35, startY, {
         width: 75
      });

   doc.fillColor(color)
      .font('Helvetica-Bold')
      .text(value || '-', 120, startY, {
         width: doc.page.width - 150
      });

   doc.y = startY + rowHeight + 5;
}

async function drawHeader(doc) {

   const turfName =
      await settingsService.getSetting('turf_name') ||
      'KICKOFF ARENA';

   const turfAddress =
      await settingsService.getSetting('turf_address') ||
      '';

   const turfPhone =
      await settingsService.getSetting('turf_phone') ||
      '';

   const turfEmail =
      await settingsService.getSetting('turf_email') ||
      '';

   doc.rect(0, 0, doc.page.width, 8)
      .fill(PRIMARY);

   doc.moveDown(.5);

   doc.fillColor(PRIMARY)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(turfName, {
         align: 'center'
      });

   doc.fillColor(TEXT)
      .fontSize(8)
      .font('Helvetica')
      .text(
         'Premium Football Turf Booking Slip',
         {
            align: 'center'
         }
      );

   doc.moveDown(.4);

   doc.fillColor(MUTED)
      .fontSize(6);

   if (turfAddress)
      doc.text(turfAddress, {
         align: 'center'
      });

   if (turfPhone)
      doc.text(`Phone: ${turfPhone}`, {
         align: 'center'
      });

   if (turfEmail)
      doc.text(`Email: ${turfEmail}`, {
         align: 'center'
      });

   doc.moveDown(.2);

   doc.moveTo(25, doc.y)
      .lineTo(doc.page.width - 25, doc.y)
      .strokeColor(BORDER)
      .lineWidth(1)
      .stroke();

   doc.moveDown(.2);
}


async function generateBookingSlipPDF(booking) {

   return new Promise(async (resolve, reject) => {

      try {

         const doc = new PDFDocument({
            size: 'A6',
            margin: 15
         });

         const buffers = [];

         doc.on('data', chunk => buffers.push(chunk));
         doc.on('end', () => resolve(Buffer.concat(buffers)));
         doc.on('error', reject);

         await drawHeader(doc);

         //----------------------------------------------------
         // Booking Reference
         //----------------------------------------------------

         const createdDate = booking.created_at
            ? new Date(booking.created_at).toLocaleDateString(
               'en-US',
               { dateStyle: 'medium' }
            )
            : new Date().toLocaleDateString(
               'en-US',
               { dateStyle: 'medium' }
            );

         doc.font('Helvetica-Bold')
            .fontSize(8)
            .fillColor(TEXT)
            .text(
               `BOOKING REF : #${booking.id || booking.booking_id || 'N/A'}`
            );

         doc.font('Helvetica')
            .fillColor(MUTED)
            .fontSize(7)
            .text(`Issued : ${createdDate}`);

         doc.moveDown(.2);

         //----------------------------------------------------
         // Customer Card
         //----------------------------------------------------

         const customerCard = drawCard(
            doc,
            'CUSTOMER INFORMATION'
         );

         row(
            doc,
            'Name',
            booking.customer_name
         );

         row(
            doc,
            'Phone',
            booking.customer_phone
         );

         if (booking.customer_email) {

            row(
               doc,
               'Email',
               booking.customer_email
            );

         }

         if (booking.team_name) {

            row(
               doc,
               'Team',
               booking.team_name
            );

         }

         finishCard(doc, customerCard);

         //----------------------------------------------------
         // Schedule Card
         //----------------------------------------------------

         const scheduleCard = drawCard(
            doc,
            'SCHEDULE'
         );

         const playDate = booking.booking_date
            ? new Date(
               booking.booking_date
            ).toLocaleDateString(
               'en-US',
               {
                  dateStyle: 'full'
               }
            )
            : '-';

         row(
            doc,
            'Date',
            playDate
         );

         row(
            doc,
            'Time',
            `${booking.start_time || '-'} - ${booking.end_time || '-'}`
         );

         finishCard(
            doc,
            scheduleCard
         );

         //----------------------------------------------------
         // Payment Summary
         //----------------------------------------------------

         const paymentCard = drawCard(
            doc,
            'PAYMENT SUMMARY'
         );

         const total = Number(booking.price || 0);
         const paid = Number(booking.amount_paid || 0);
         const due = Math.max(0, total - paid);

         row(
            doc,
            'Total Charge',
            money(total)
         );

         row(
            doc,
            'Amount Paid',
            money(paid)
         );

         row(
            doc,
            'Balance Due',
            money(due),
            due > 0 ? '#f59e0b' : PRIMARY
         );

         row(
            doc,
            'Status',
            (booking.payment_status || 'UNPAID').toUpperCase(),
            (booking.payment_status || '').toLowerCase() === 'paid'
               ? PRIMARY
               : '#f59e0b'
         );

         if (booking.payment_method) {

            doc.moveDown(.2);

            doc.font('Helvetica')
               .fontSize(7)
               .fillColor(MUTED)
               .text(
                  `Payment Method : ${booking.payment_method}`
               );

         }

         if (booking.transaction_id) {

            doc.font('Helvetica')
               .fontSize(7)
               .fillColor(MUTED)
               .text(
                  `Transaction ID : ${booking.transaction_id}`
               );

         }

         finishCard(doc, paymentCard);

         //----------------------------------------------------
         // Instructions
         //----------------------------------------------------

         doc.moveDown(.5);

         doc.font('Helvetica-Bold')
            .fontSize(7)
            .fillColor(TEXT)
            .text('IMPORTANT INSTRUCTIONS');

         doc.moveDown(.5);

         const rules = [
            'Please arrive at least 10 minutes before your booking.',
            'Only turf shoes or indoor flats are allowed.',
            'Extensions are subject to slot availability.',
            'Management reserves the right to cancel bookings due to unavoidable circumstances.'
         ];

         doc.font('Helvetica')
            .fontSize(6.5)
            .fillColor(MUTED);

         rules.forEach(rule => {
            doc.text(`• ${rule}`);
         });

         //----------------------------------------------------
         // Footer
         //----------------------------------------------------

         doc.moveDown(.5);

         doc.moveTo(25, doc.y)
            .lineTo(doc.page.width - 25, doc.y)
            .strokeColor(BORDER)
            .stroke();

         doc.moveDown(.5);

         doc.fillColor(PRIMARY)
            .font('Helvetica-Bold')
            .fontSize(9)
            .text(
               'THANK YOU FOR PLAYING!',
               {
                  align: 'center'
               }
            );

         doc.moveDown(.2);

         doc.font('Helvetica')
            .fillColor(MUTED)
            .fontSize(6.5)
            .text(
               'We look forward to seeing you again.',
               {
                  align: 'center'
               }
            );

         doc.end();

      } catch (err) {

         reject(err);

      }

   });

}

module.exports = {
   generateBookingSlipPDF
};


