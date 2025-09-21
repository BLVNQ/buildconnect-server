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

transporter.verify(function (error, success) {
  if (error) {
    console.log("--- GMAIL CONNECTION ERROR ---");
    console.log(error);
  } else {
    console.log("✅ Gmail connection successful. Server is ready to send emails.");
  }
});

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('BuildConnect Backend is connected to Firebase!');
});


// --- THIS IS THE UPDATED Payment Order Endpoint with FINAL DEBUGGING ---
app.post('/api/create-order', async (req, res) => {
  try {
    const { amount } = req.body;

    // --- FINAL DEBUG LOGS ---
    console.log("--- RAZORPAY DEBUG: RECEIVED REQUEST ---");
    console.log(`1. Raw amount received from frontend: ${amount}`);
    console.log(`2. Type of amount received: ${typeof amount}`);
    
    if (typeof amount !== 'number' || amount < 1 || isNaN(amount)) {
      console.error("--- RAZORPAY DEBUG: ERROR! Invalid amount received from frontend.");
      return res.status(400).send({ error: 'Invalid amount for payment.' });
    }
    
    const amountInPaise = Math.round(amount * 100);
    console.log(`3. Calculated amount in paise: ${amountInPaise}`);
    // ----------------------

    const options = {
      amount: amountInPaise, 
      currency: "INR",
      receipt: `receipt_order_${new Date().getTime()}`
    };

    console.log("4. Full options object being sent to Razorpay:", options);
    
    // --- THIS IS THE MOST IMPORTANT PART ---
    // We will wrap the call to Razorpay in its own try...catch block
    // to get the most detailed error possible.
    try {
        const order = await razorpay.orders.create(options);
        if (!order) {
            console.error("--- RAZORPAY DEBUG: Order creation returned null/undefined.");
            return res.status(500).send('Error creating order');
        }
        console.log("5. SUCCESS! Razorpay order created successfully.");
        res.json(order);
    } catch (razorpayError) {
        console.error("--- RAZORPAY DEBUG: CRITICAL ERROR FROM RAZORPAY SDK ---");
        console.error("The following error occurred while trying to create a Razorpay order:");
        console.error("Error Code:", razorpayError.statusCode);
        console.error("Error Details:", razorpayError.error);
        res.status(razorpayError.statusCode || 500).send(razorpayError.error);
    }
    // ------------------------------------------

  } catch (error) {
    // This outer catch is a failsafe
    console.error("--- RAZORPAY DEBUG: UNEXPECTED SERVER ERROR ---");
    console.error(error);
    res.status(500).send("An unexpected error occurred on the server.");
  }
});
// ---------------------------------------------

// --- All other endpoints are here, complete and correct ---
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
      dataToSave = { name, description, rate: Number(price), rateType, imageUrl, location, merchantId, category: 'General', availabilityStatus: 'Available' };
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
    try {
      const user = await admin.auth().getUser(userId);
      const userEmail = user.email;
      const itemsList = cartItems.map(item => `<li>${item.name} (Quantity: ${item.quantity})</li>`).join('');
      const mailOptions = {
        from: `BuildConnect <${process.env.GMAIL_ADDRESS}>`, to: userEmail, subject: `Your BuildConnect Booking Confirmation (#${bookingRef.id.substring(0, 8)})`, html: `<h1>Booking Confirmed!</h1><p>Thank you for your order with BuildConnect.</p><h3>Order Summary:</h3><ul>${itemsList}</ul><h3>Total Amount: ₹${totalPrice.toLocaleString()}</h3><p>Your items will be delivered to:</p><p>${siteLocation.address},<br>${siteLocation.area},<br>${siteLocation.city} - ${siteLocation.pincode}</p><p>Contact No: ${siteLocation.contactNo}</p>`
      };
      await transporter.sendMail(mailOptions);
      console.log('Confirmation email sent to:', userEmail);
    } catch (emailError) {
      console.error("Failed to send confirmation email:", emailError);
    }
    res.status(201).send({ message: 'Booking created successfully!', bookingId: bookingRef.id });
  } catch (error) { res.status(500).send({ error: 'Failed to create booking.' }); }
});
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    const userRecord = await admin.auth().createUser({ email, password, displayName: name });
    await db.collection('users').doc(userRecord.uid).set({ name, email, role });
    res.status(201).send({ message: 'User created successfully!', uid: userRecord.uid });
  } catch (error) { res.status(400).send({ error: error.message }); }
});
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