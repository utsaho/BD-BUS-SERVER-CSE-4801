const express = require("express");
const app = express();
const cors = require("cors");
var jwt = require('jsonwebtoken');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { google }= require('googleapis');
const apikeys = require('./apikeys.json');  // COMMENT: google api keys
var ElasticEmail = require('@elasticemail/elasticemail-client');
const { Vonage } = require('@vonage/server-sdk');
const multer = require('multer');

require("dotenv").config();
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY);
const port = process.env.PORT || 5000;

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());

// COMMENT: elastic email config
var defaultClient = ElasticEmail.ApiClient.instance;
var apikey = defaultClient.authentications['apikey'];
apikey.apiKey =process.env.SMTP_ELASTIC_API_KEY
let api = new ElasticEmail.EmailsApi()

// COMMENT: VONAGE API KEY FOR OTP
const vonage = new Vonage({
  apiKey: process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_SECRET_KEY
});

const verifyWebToken = (req, res, next) =>{
    const authorization = req.headers.authorization;
    if(!authorization){
        return res.status(401).send({error: true, message: 'unauthorized access'});
    }

    const token = authorization.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded)=>{
        if(err){
            return res.status(403).send({error: true, message: 'unauthorized access token'});
        }
        req.decoded = decoded;
        next();
    })
}

// COMMENT: mail template for bookign confirmation
const sendMail = ({busData, email, name, persons, transactionID, pdfURL}) =>{
    // console.log(busData);
    let postMail = ElasticEmail.EmailMessageData.constructFromObject({
        Recipients: [
          new ElasticEmail.EmailRecipient(email)
        ],
        Content: {
          Body: [
            ElasticEmail.BodyPart.constructFromObject({
              ContentType: "HTML",
              Content: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
</head>
<body>
    <p>Dear ${name},</p>
    <p><h3>Congratulations!</h3> Your seat booking for <b>${busData.from} to ${busData.to}</b> is confirmed. Please keep your transaction id (<b style="color: red;">${transactionID} </b>) safe.</p>
    <p>Here is your <a href="${pdfURL}">TICKET</a></p>
    <h5>Verify your ticket and print <a href="http://localhost:5173/dashboard/verify-ticket">HERE</a></h5>
    <p><b>Thank you for choosing us.</b></p>
    <h4>Here is your travel information:</h4>
    <ol>
       <li><b>Total passenger: ${persons.length}</b></li>
       <li><b>Bus time: ${busData.from} (${busData.depTime})</b></li>
       <li><b>Fare: ${(busData.cost)*(persons.length)} BDT</b></li>
       <li><b>Contact email: ${email}</b></li>
    </ol>
</body>
</html>`
            })
          ],
          Subject: `Payment Confirmation for ${busData.bus.Operator} is confirmed.`,
          From: process.env.SMTP_MAIL
        },
      });
      
    var callback = function(error, data, response) {
        if (error) {
          console.error(error);
        } else {
          console.log('API called successfully.');
        }
      };
      api.emailsPost(postMail, callback);
}

// COMMENT: mail template for contact
const contactMail = ({name, email, message}) =>{
    let postMail = ElasticEmail.EmailMessageData.constructFromObject({
        Recipients: [
          new ElasticEmail.EmailRecipient(process.env.SMTP_MAIL)
        ],
        Content: {
          Body: [
            ElasticEmail.BodyPart.constructFromObject({
              ContentType: "HTML",
              Content: `<div>
              <b>Hey there!</b>
              <p>I am ${name},</p>
              <p><b>Email: </b> ${email}</p> </br>
              <p><b>message: </b> ${message}</p>
              </div>`
            })
        ],
        Subject: `BUS BD had new message from ${name}.`,
        From: process.env.SMTP_MAIL
      }
    });
    
  var callback = function(error, data, response) {
      if (error) {
        console.error(error);
      } else {
        console.log('contact email successfully.');
      }
    };
    api.emailsPost(postMail, callback);
}

// COMMENT: send attachment
app.get('/sendPDF', async (req, res) => {
    const email = 'pipul.boddyo@gmail.com';
    const content = fs.readFileSync('./ticket.pdf').toString('base64');
    console.log(content);
    let postMail = ElasticEmail.EmailMessageData.constructFromObject({
        Recipients: [
          new ElasticEmail.EmailRecipient(email)
        ],
        Content: {
          Body: [
            ElasticEmail.BodyPart.constructFromObject({
              ContentType: "HTML",
              Content: `<div>
              <b>Hey there!</b>
              <p>I am ,</p>
              <p><b>Email: </b> </p> </br>
              <p><b>message: </b> </p>
              </div>`
            }),
        ],
        
        Subject: `BUS BD had new message from.`,
        From: process.env.SMTP_MAIL
      },
      Attachments:[
        new ElasticEmail.MessageAttachment({
            binaryContent: content,
            name:'attachment.pdf',
            contentType: 'application/pdf'
        })
      ]
    });
    
  var callback = function(error, data, response) {
      if (error) {
        console.error(error);
      } else {
        console.log('contact email successfully.');
        // res.send({data})
        res.send({status:true})
      }
    };
    api.emailsPost(postMail, callback);
});


// COMMENT: google authorization
const SCOPE = ["https://www.googleapis.com/auth/drive"];
async function authorize(){
    const jwtClient = new google.auth.JWT(
        apikeys.client_email,
        null,
        apikeys.private_key,
        SCOPE
    );

    await jwtClient.authorize();
    return jwtClient;
}




const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@practiceweb.uutqnsh.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const busCollection = client.db("BDBUS").collection("busInfo");
    const bookingCollection = client.db("BDBUS").collection("bookings");
    const stationCollection = client.db("BDBUS").collection("stations");
    const userCollection = client.db("BDBUS").collection("users");

    // COMMENT: JWT access token
    app.post('/token', async(req, res)=>{
        const user = req.body;
        const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET,{ expiresIn: '1h' });
        res.send({token});
    });

    // COMMENT: load data for home
    app.get('/home', async(req, res)=>{
        const busInfo = await busCollection.find().toArray();
        const operators = busInfo.map(bus => bus.Operator);
        const routes = busInfo.map(bus => bus.route);
        res.send({operators, routes});
    });

    //COMMENT: sending OTP
    app.get('/sendOTP/:number', async(req, res)=>{
        const number = req.params?.number;
        console.log(number);
        // res.send({status:true})
        vonage.verify.start({
            number: "8801304245824",
            brand: "Vonage"
          }).then(resp => res.send({request_id:resp.request_id})).catch(err => res.send({status:false}));
    });

    // COMMENT: VERIFY OTP
    app.get('/verifyOTP/:request_id/:code', async(req, res)=>{
        const REQUEST_ID = req.params?.request_id;
        const CODE = req.params?.code;
        console.log(REQUEST_ID, CODE);
        vonage.verify.check(REQUEST_ID, CODE).then(resp => res.send({status:true, resp})).catch(err => res.send({status:false, err}));
    });
    

    
    // COMMENT: Upload pdf to drive and return file link
    app.get('/fileUpload/:id', async(req, res)=>{
        const id = req.params?.id;
        const fun = async(authClient)=>{
            return new Promise((resolve, reject) => {
              const drive = google.drive({version: 'v3', auth: authClient});
              var fileData = {
                name : `${id}-ticket.pdf`,
                parents:["1JW7D-6HZcJMg0sXJAedK_qfnhgghK0CD"],
              }
              drive.files.create({
                resource: fileData,
                media: {
                    body: fs.createReadStream('ticket.pdf'),
                    mimeType: 'application/pdf',
                },
                fields: 'id'
              }, (err, file) => {
                if(err) return reject(err);
                resolve(file);
              })
            })
        }
        authorize().then(authClient => fun(authClient)).then(result => res.send(result)).catch('error')
    });
    
    
    // COMMENT: get all users by SUPERADIN
    app.get('/getUsers/:email', async(req, res)=>{
        const email = req.params?.email;
        const exist = await userCollection.findOne({email})
        let result = {status : false};
        if(exist)result = await userCollection.find().toArray();
        res.send(result)
    });

    // COMMENT: SUPERADMIN add new operator
    app.post('/superAdmin/:email', async(req, res)=>{
        const email = req.params.email;
        const operatorName = req.body?.operatorName;
        const user = req.body?.makeAdminUser;
        if(email && operatorName){
            // console.log(email);
            const exist = await userCollection.findOne({email: user?.email});
            if(exist) {
                const result = await userCollection.updateOne({email: user?.email}, {$set:{operatorName: operatorName, role:'admin'}})
                res.send(result)
            }else res.send({status:false}); 
        }
        else res.send({status:true})
    });
    

    // COMMENT: ADMIN  ADD NEW BUS
    app.post('/add-new-bus/:email', async(req, res)=>{
        const data = req.body?.busInfo;
        // COMMENT: Adding new stations
        const stations = req.body?.stations;
        let stationInserted = false;
        for (const station of stations) {
            const exist = await stationCollection.findOne({ name: station.name });
            const stationResult = !exist && await stationCollection.insertOne(station);
            if(stationResult) stationInserted = true;
        }
        
        // COMMENT: Addeing new bus
        const busResult = await busCollection.insertOne(data);
        // const stationResult = await stationCollection.insertMany(stations)
        res.send({busResult,stationInserted})
    });

    // COMMENT:  ADMIN Mail Send
    app.post('/postEmail', async(req, res)=>{
        const data = req.body;
        sendMail(data);
        res.send(data)
    })
    
    // COMMENT: Contact api
    app.post('/contact', async(req, res)=>{
        const message = req.body?.messageData;
        contactMail(message);
        res.send(message);
    });
    

    // COMMENT: save user information
    app.post("/users", async(req, res) =>{
        const user = req.body;
        const query = {email: user.email}
        const userExist = await userCollection.findOne(query);
        if(userExist) return res.send({message: "user already exist"});
        const result = userCollection.insertOne(user);
        res.send(result);
    });


    // COMMENT: update user profile
    app.post("/updateProfile/:email", async(req, res)=>{
        const data = req.body?.newData;
        // console.log(data?.data);
        const email = req.params.email;
        const result = await userCollection.updateOne({email:data.email}, {$set:data})
        // console.log(email);
        res.send(result);
    });

    // COMMENT: making users to admin
    app.patch("/users/admin/:id", async(req, res)=>{
        const id = req.params.id;
        const filter = {_id: new Object(id)};
        const updateDoc = {
            $set:{role: 'admin'}
        }
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result);
    });

    // COMMENT: get single user data for checking rules
    app.get("/user/:email", async(req, res)=>{
        const email = req.params.email;
        // const decodedEmail = req.decoded.email;
        // if(decodedEmail !== email){
        //     return res.status(403).send({error: true, message: 'Forbidden Access'})
        // }
        const result = await userCollection.findOne({email: email});
        res.send(result);
    });


    // COMMENT: Verify-Tieket and customers for admin
    app.get("/verify-ticket/:email/:transactionNumber", async(req, res)=>{
        const email = req.params.email;
        const transactionID = req.params.transactionNumber
        const query = req?.query;
        // console.log(query);
        if(transactionID == 'false') {
            if(query?.count == 'true'){
                const count = await bookingCollection.countDocuments({'passengerDetails.email':email});
                return res.send({count})
                // await bookingCollection.find({'passengerDetails.email':email}).toArray();

            }else{
                const perPage = parseInt(query?.perPage);
                const currentPage = parseInt(query?.page);
                const result2 = await bookingCollection.find({'passengerDetails.email':email}).skip(perPage*currentPage).limit(perPage).toArray();
                return res.send(result2)
            }
        }
        const result = await bookingCollection.findOne({transactionID:transactionID})
        res.send(result);
    });


    // COMMENT: set availability of bus
    app.patch('/setBusAvailable/:busID', async(req, res)=>{
        const status = req.body?.status;
        const busID = req?.params?.busID;
        const bus = await busCollection.findOne({_id: new ObjectId(busID)});
        if(bus){
            const result = await busCollection.updateOne({_id: new ObjectId(busID)}, { $set: { ['available']: status}})
            res.send(result)
        }
        else res.send({status})
    });

    // COMMENT: Bus Deletion
    app.post('/deleteBus', async(req, res)=>{
        const busID = req.body.busID;
        const found = await busCollection.findOne({_id: new ObjectId(busID)});
        if(found){
            const deletedResult = await busCollection.deleteOne({_id: new ObjectId(busID)})
            res.send(deletedResult)
        }
        else return  res.status(404).send('bus not found');
    });

    // COMMENT: Bus search admin for account history;
    app.post('/accountHistory/:email', async(req, res)=>{
        const email = req.params.email;
        const query = req.body?.query;
        const currentDate = `${new Date().toISOString().split('T')[0]}`;
        const operatorResult = await userCollection.findOne({email})
        if(operatorResult?.operatorName){
            const operatorName = operatorResult.operatorName;
            let busResult = await busCollection.find({Operator:operatorName}).toArray();
            
            let bookings = await bookingCollection.find({'busData.bus.Operator': operatorResult?.operatorName}).toArray();

            if((query?.availability =='true' || query?.availability =='false')){
                const availableValue = query.availability === 'true'
                const q = {
                    $and:[
                        {Operator: operatorName},
                        {available: availableValue}
                    ]
                }
                busResult = await busCollection.find(q).toArray();
            }
            if(query?.selectedBus !== 'All' && query?.selectedBus){
                const busName = query.selectedBus;
                busResult = busResult.filter(bus => bus.name === busName);
            }
            if(query?.fromDate || query?.toDate){
                const fromDate = query.fromDate || currentDate;
                const toDate = query.toDate || currentDate;
                const q = {
                    $and:[
                        {'busData.bus.Operator': operatorResult?.operatorName},
                        {'busData.date': {$gte:fromDate, $lte:toDate}},
                        // {'busData.date': {$lte:toDate}},
                        // {'busData.bus.Operator': operatorResult?.operatorName},
                        // {'busData.date': {$gte:fromDate}},
                        // {'busData.date': {$lte:toDate}}
                    ]
                }
                bookings = await bookingCollection.find(q).toArray();
            }
        if(query) res.send({busResult, bookings});
        }else res.send({status:false});
    });


    // COMMENT: API FOR MANAGING BUS
    app.get("/busInfo/:email", async (req, res) => {
        const email = req.params.email;
        const operatorResult = await userCollection.findOne({email})
        if(operatorResult?.operatorName){
            const operatorName = operatorResult.operatorName;
            const result = await busCollection.find({Operator:operatorName}).toArray();
            res.send(result);
        }else res.send({status:false});
    });
    

    // COMMENT: ADMIN getting bookings
    app.patch("/bookings", async (req, res) => {
        const operator = req.body?.operator;
        const query = req.body?.query;
        const paginationQuery = req?.query;
        console.log(paginationQuery);
        let currentPage;
        let perPage;
        if(!paginationQuery?.count){
            currentPage = parseInt(paginationQuery?.currentPage);
            perPage = parseInt(paginationQuery?.perPage);
        }
        if(query?.filter){
            const {searchText, filter} = query;
            if(filter){{
                const query = {
                    $and:[{"busData.bus.Operator":operator},
                        {$or:[
                            {'busData.bus.name':searchText},
                            {'busData.date':searchText},
                            {'passengerDetails.email':searchText},
                            {'passengerDetails.phone':searchText},
                        ]}]
                }
                if(paginationQuery?.count == 'true'){
                    const count = await bookingCollection.countDocuments(query);
                    return res.send({count});
                    
                }
                const bookings = await bookingCollection.find(query).skip(currentPage*perPage).limit(perPage).toArray();
                return res.send(bookings);
            }}
        }else{
            if(paginationQuery?.count == 'true'){
                const count = await bookingCollection.countDocuments({"busData.bus.Operator":operator});
                return res.send({count});
            }
            const bookings = await bookingCollection.find({"busData.bus.Operator":operator}).skip(currentPage*perPage).limit(perPage).toArray();
            return res.send(bookings);
        }
    });

    // COMMENT: api used in useSearchBus hook and SearchBusResult.jsx
    app.post("/search", async (req, res) => {
      const info = req.body;
      const from = info?.from;
      const to = info?.to;
      const date = info?.date;
      const query = {
        $and: [
          { stoppages: { $elemMatch: { name: from } } },
          { stoppages: { $elemMatch: { name: to } } },
          {available:true}
        ],
      };
      
      const bus = await busCollection.find(query).toArray();
      const bookings = await bookingCollection.find({"busData.date": date}).toArray();

      const bookedSeats = bookings.flatMap((booking) => {
        let busAndSeat = {
            'seats': booking.persons.map((person) => person.seatNo),
            'id': booking.busData.bus._id
        }
        return {busAndSeat}
    });

      bus.forEach((bus) => {
        bookedSeats.map(item =>{
            if(bus._id == item.busAndSeat.id){
                bus.availableSeats = bus.availableSeats.filter(seat=> !item.busAndSeat.seats.includes(seat))
                const oldBooked = bus.booked;
                bus.booked = oldBooked? item.busAndSeat.seats.concat(oldBooked) : item.busAndSeat.seats;
                bus.booked = bus.booked.slice().sort((a, b) => a - b);
            }
        })
      });
      res.send(bus);
    });

    // COMMENT: api for getting stoppages
    app.get("/stations", async (req, res) => {
      const result = await stationCollection.find().toArray();
      res.send(result);
    });

    // COMMENT: PAYMENT GETAWAY
    app.post('/payment-intent', async(req, res)=>{
        const {fare} = req.body;
        const amount = parseInt(fare * 100);
        // console.log(typeof amount);
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: "usd",
            payment_method_types: ['card']
        });

        res.send({
            clientSecret: paymentIntent.client_secret
        });
    });

    // COMMENT: inserting transactionID with user information
    app.post('/check', async(req, res)=>{    /* COMMENT: Axios used */
        const data = req.body;
        const result = bookingCollection.insertOne(data);
        res.send(result)
    });

    // COMMENT:making pdf
    app.post('/makePDF', async(req, res)=>{
        const data = req.body;
        const operator = data?.busData?.bus?.Operator;
        const busName = data?.busData?.bus?.name;
        const email = data?.email;
        const name = data?.name;
        const phone = `data?.phone`;
        const transactionID = data?.transactionID;
        const persons = data?.persons?.length;
        const route = data?.busData?.bus?.route;
        const seatNos = data?.seatNos;
        const date = `${data?.busData?.date} [ ${data?.busData?.depTime} ]`;
        const destination = `${data?.busData?.from} - ${data?.busData?.to}`;
        console.log(data);
        // return res.send(data);
    try{
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        await page.setContent(`<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Document</title>
        </head>
        <body>
            <h2 style="margin-top: 3px; margin-bottom: 3px;">${operator}</h2>
            <h5 style="color: green; margin-top: 4px; margin-bottom: 4px;">${busName}</h5>
            <p style="margin-top: 0px; margin-bottom: 1px;"><b>${route}</b></p>
            <hr>
            <p style="margin-top: 0px; margin-bottom: 1px;"><b>Name: </b>${name}</p>
            <p style="margin-top: 0px; margin-bottom: 1px;"><b>Phone: </b>${phone}</p>
            <p style="margin-top: 0px; margin-bottom: 1px;"><b>Email: </b>${email}</p>
            <p style="margin-top: 0px; margin-bottom: 1px;"><b>TransactionID: </b>${transactionID}</p>
            <p style="margin-top: 0px; margin-bottom: 1px;"><b>Destination: </b>${destination}</p>
            <p style="margin-top: 0px; margin-bottom: 1px;"><b style="color: green;">Date and Time: </b>${date}</p>
            <br>
            <p style="margin-top: 0px; margin-bottom: 1px; color: green;"><b>Passenger Details: </b>${persons}</p>
            <p style="margin-top: 0px; margin-bottom: 1px;"><b>SeatNo: </b>${seatNos}</p>
        </body>
        </html>`);
        await page.emulateMediaType('screen');
        await page.pdf({path: 'ticket.pdf', format: 'A4', printBackground: true});
        console.log('done');
        await browser.close();
    }
    catch(err){
        console.log('CATCH ERROR: ', err);
    }
    res.send({status: true})
});
    
    

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("server is running...");
});

app.listen(port, () => {
  console.log(`Server is running on: ${port} port`);
});
