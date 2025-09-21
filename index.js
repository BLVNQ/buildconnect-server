require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const Razorpay = require('razorpay');
const nodemailer = require('nodemailer');

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_ADDRESS,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// --- NEW DIAGNOSTIC CODE ---
// This will test the connection to Gmail as soon as the server starts.
transporter.verify(function (error, success) {
  if (error) {
    console.log("--- GMAIL CONNECTION ERROR ---");
    console.log("There is a problem connecting to your Gmail account. The most common reasons are:");
    console.log("1. The GMAIL_ADDRESS in your .env file is incorrect.");
    console.log("2. The GMAIL_APP_PASSWORD in your .env file is incorrect (it should be 16 characters with no spaces).");
    console.log("3. 2-Step Verification may have been turned off on your Google Account, which invalidates the App Password.");
    console.log("--- FULL ERROR DETAILS ---");
    console.log(error);
  } else {
    console.log("✅ Gmail connection successful. Server is ready to send emails.");
  }
});
// -----------------------------

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('BuildConnect Backend is connected to Firebase!');
});

// --- Booking Endpoint with DETAILED LOGGING ---
app.post('/api/create-booking', async (req, res) => {
  try {
    const { userId, cartItems, totalPrice, paymentDetails, siteLocation } = req.body;
    if (!userId || !cartItems || !cartItems.length || !siteLocation) {
      return res.status(400).send({ error: 'Missing booking information.' });
    }
    const bookingRef = await db.collection('bookings').add({
      clientId: userId,
      items: cartItems, 
      totalAmount: totalPrice, 
      status: 'Confirmed', 
      bookingDate: new Date().toISOString(), 
      paymentDetails: paymentDetails || {},
      siteLocation: siteLocation
    });

    // --- NEW DETAILED EMAIL LOGGING ---
    console.log("--- Starting Email Process ---");
    try {
      const user = await admin.auth().getUser(userId);
      const userEmail = user.email;
      console.log(`Step 1: Found user email: ${userEmail}`);

      const itemsList = cartItems.map(item => `<li>${item.name} (Quantity: ${item.quantity})</li>`).join('');

      const mailOptions = {
        from: `BuildConnect <${process.env.GMAIL_ADDRESS}>`,
        to: userEmail,
        subject: `Your BuildConnect Booking Confirmation (#${bookingRef.id.substring(0, 8)})`,
        html: `
          <h1>Booking Confirmed!</h1>
          <p>Thank you for your order with BuildConnect.</p>
          <h3>Order Summary:</h3>
          <ul>
            ${itemsList}
          </ul>
          <h3>Total Amount: ₹${totalPrice.toLocaleString()}</h3>
          <p>Your items will be delivered to:</p>
          <p>
            ${siteLocation.address},<br>
            ${siteLocation.area},<br>
            ${siteLocation.city} - ${siteLocation.pincode}
          </p>
          <p>Contact No: ${siteLocation.contactNo}</p>
        `
      };
      console.log("Step 2: Mail options prepared. Attempting to send email...");

      await transporter.sendMail(mailOptions);
      
      console.log(`✅ Step 3: SUCCESS! Confirmation email sent to: ${userEmail}`);

    } catch (emailError) {
      console.error("--- EMAIL SENDING FAILED ---");
      console.error(emailError);
    }
    // ---------------------------------

    res.status(201).send({ message: 'Booking created successfully!', bookingId: bookingRef.id });
  } catch (error) { res.status(500).send({ error: 'Failed to create booking.' }); }
});

// --- My Bookings Endpoint ---
app.get('/api/my-bookings/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const bookingsQuery = db.collection('bookings').where('clientId', '==', userId);
    const snapshot = await bookingsQuery.get();
    if (snapshot.empty) {
      return res.status(200).json([]);
    }
    const bookingsList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    bookingsList.sort((a, b) => new Date(b.bookingDate) - new Date(a.bookingDate));
    res.status(200).json(bookingsList);
  } catch (error) {
    console.error("Error fetching user bookings:", error);
    res.status(500).send({ error: 'Failed to fetch bookings.' });
  }
});

// --- Cancel Booking Endpoint ---
app.put('/api/bookings/:bookingId/cancel', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const bookingRef = db.collection('bookings').doc(bookingId);
    await bookingRef.update({ status: 'Cancelled' });
    res.status(200).send({ message: 'Booking cancelled successfully!' });
  } catch (error) {
    console.error("Error cancelling booking:", error);
    res.status(500).send({ error: 'Failed to cancel booking.' });
  }
});

// --- Payment Order Endpoint ---
app.post('/api/create-order', async (req, res) => {
  try {
    const { amount } = req.body;
    const options = {
      amount: amount * 100, currency: "INR", receipt: `receipt_order_${new Date().getTime()}`
    };
    const order = await razorpay.orders.create(options);
    if (!order) return res.status(500).send('Error creating order');
    res.json(order);
  } catch (error) {
    res.status(500).send("Something went wrong");
  }
});

// --- Edit Listing Endpoint ---
app.put('/api/listing/:collectionName/:listingId', async (req, res) => {
  try {
    const { collectionName, listingId } = req.params;
    const updatedData = req.body;
    if (['equipment', 'materials', 'contractors'].includes(collectionName)) {
      await db.collection(collectionName).doc(listingId).update(updatedData);
      res.status(200).send({ message: 'Listing updated successfully!' });
    } else {
      res.status(400).send({ error: 'Invalid collection specified.' });
    }
  } catch (error) { res.status(500).send({ error: 'Failed to update listing.' }); }
});

// --- Delete Listing Endpoint ---
app.delete('/api/listing/:collectionName/:listingId', async (req, res) => {
  try {
    const { collectionName, listingId } = req.params;
    if (['equipment', 'materials', 'contractors'].includes(collectionName)) {
      await db.collection(collectionName).doc(listingId).delete();
      res.status(200).send({ message: 'Listing removed successfully!' });
    } else {
      res.status(400).send({ error: 'Invalid collection specified.' });
    }
  } catch (error) { res.status(500).send({ error: 'Failed to remove listing.' }); }
});

// --- My Listings Endpoint ---
app.get('/api/my-listings/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const eqQuery = db.collection('equipment').where('merchantId', '==', userId);
    const matQuery = db.collection('materials').where('merchantId', '==', userId);
    const conQuery = db.collection('contractors').where('merchantId', '==', userId);
    const [eqSnap, matSnap, conSnap] = await Promise.all([eqQuery.get(), matQuery.get(), conQuery.get()]);
    const eqList = eqSnap.docs.map(doc => ({ id: doc.id, collection: 'equipment', ...doc.data() }));
    const matList = matSnap.docs.map(doc => ({ id: doc.id, collection: 'materials', ...doc.data() }));
    const conList = conSnap.docs.map(doc => ({ id: doc.id, collection: 'contractors', ...doc.data() }));
    res.status(200).json([...eqList, ...matList, ...conList]);
  } catch (error) { res.status(500).send({ error: 'Failed to fetch listings.' }); }
});

// --- Add Listing Endpoint ---
app.post('/api/add-listing', async (req, res) => {
  try {
    const { listingType, name, description, price, imageUrl, location, merchantId, rateType, specialization, unit } = req.body;
    if (!listingType || !name || !price || !merchantId) {
      return res.status(400).send({ error: 'Missing required fields.' });
    }
    let collectionName = '';
    let dataToSave = {};
    if (listingType === 'Equipment') {
      collectionName = 'equipment';
      dataToSave = { name, description, dailyRentalPrice: Number(price), imageUrl, location, merchantId, category: 'General', availabilityStatus: 'Available' };
    } else if (listingType === 'Material') {
      collectionName = 'materials';
      dataToSave = { name, specs: description, pricePerUnit: Number(price), imageUrl, merchantId, unit, stockQuantity: 100 };
    } else if (listingType === 'Contractor') {
      collectionName = 'contractors';
      dataToSave = { name, bio: description, rate: Number(price), profileImageUrl: imageUrl, location, merchantId, rateType, specialization };
    } else {
      return res.status(400).send({ error: 'Invalid listing type.' });
    }
    const docRef = await db.collection(collectionName).add(dataToSave);
    res.status(201).send({ message: 'Listing created successfully!', id: docRef.id });
  } catch (error) { res.status(500).send({ error: 'Failed to create listing.' }); }
});

// --- User Registration Endpoint ---
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    const userRecord = await admin.auth().createUser({ email, password, displayName: name });
    await db.collection('users').doc(userRecord.uid).set({ name, email, role });
    res.status(201).send({ message: 'User created successfully!', uid: userRecord.uid });
  } catch (error) { res.status(400).send({ error: error.message }); }
});

// --- Public Data Fetching Endpoints ---
app.get('/api/equipment', async (req, res) => {
  try {
    const snapshot = await db.collection('equipment').get();
    const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(list);
  } catch (error) { res.status(500).send("Something went wrong"); }
});

app.get('/api/materials', async (req, res) => {
  try {
    const snapshot = await db.collection('materials').get();
    const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(list);
  } catch (error) { res.status(500).send("Something went wrong"); }
});

app.get('/api/contractors', async (req, res) => {
  try {
    const snapshot = await db.collection('contractors').get();
    const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(list);
  } catch (error) { res.status(500).send("Something went wrong"); }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});