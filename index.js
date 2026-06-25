const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require('express')
const app = express()
const dontenv = require('dotenv')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
const { features } = require("node:process");
dontenv.config()

const PORT = process.env.PORT
const uri = process.env.MONGO_URI
app.use(cors())
app.use(express.json())


const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

const JWKS = createRemoteJWKSet(
    new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
)

const varyfitoken = async (req, res, next) => {
    const authheader = req?.headers.authorization

    if (!authheader) {
        return res.status(401).json({ message: "Unauthorize" })
    }
    const token = authheader.split(" ")[1]

    if (!token) {
        return res.status(401).json({ message: "Unauthorize" })
    }

    try {
        const { payload } = await jwtVerify(token, JWKS)
        req.user = {
            id: payload.sub,
            email: payload.email,
            role: payload.role
        };

        console.log(payload)
        next()
    } catch (error) {
        console.log(error)
        return res.status(403).json({ message: "Forbidden" })
    }



}

const verifyAdmin = (req, res, next) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({
            message: "Admin access only"
        });
    }

    next();
};
async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        const db = client.db("webapp")
        const bookcolloection = db.collection('books')
        const subscriptioncollection = db.collection('subscription')
        const usercollection = db.collection('user')
        const ordercollection = db.collection('order')
        const reviewsection = db.collection('review')

        // payment system api and staus change
        // app.post("/subscription", async (req, res) => {
        //     const { priceid, useremail, userid, sessionid, bookId } = req.body;
        //     console.log(priceid, useremail, userid, sessionid, bookId)
        //     const isExist = await subscriptioncollection.findOne({ sessionid });
        //     if (isExist) {
        //         return res.json({ msg: "Already exist!" });
        //     }

        //     await subscriptioncollection.insertOne({
        //         priceid,
        //         useremail,
        //         userid,
        //         sessionid,
        //         bookId
        //     });

        //     //update user role
        //     await bookcolloection.updateOne(
        //         { _id: new ObjectId(bookId) },
        //         { $set: { status: "Pending delevery" } },
        //     );

        //     res.json({ msg: "Payment successfull!" });
        // });


        // seller create booksinfo
        app.post('/seller/books', varyfitoken, async (req, res) => {
            const bookdata = req.body
            bookdata.sellerId = req.user.id;
            console.log(bookdata)
            // for status
            bookdata.status = "Pending Approval";
            bookdata.publishStatus = "Unpublished";
            bookdata.createdAt = new Date();
            const result = await bookcolloection.insertOne(bookdata)

            res.json(result)
        })

        // seller get all booksinfo
        app.get('/seller/books', varyfitoken, async (req, res) => {
            const result = await bookcolloection.find({ sellerId: req.user.id }).toArray()
            res.json(result)
        })


        app.get('/books', async (req, res) => {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 6;


            const skip = (page - 1) * limit;
            console.log(`Requested Page: ${page}, Skip: ${skip}`)
            const {
                search,
                category,
                minFee,
                maxFee,
                availability
            } = req.query;

            const query = {
                publishStatus: "Published"
            };

            if (search) {
                query.title = {
                    $regex: search,
                    $options: "i"
                };
            }

            // Filter by Category
            if (category) {
                query.category = category;
            }

            // Filter by Delivery Fee
            if (minFee || maxFee) {
                query.$expr = {};

                const conditions = [];

                if (minFee) {
                    conditions.push({
                        $gte: [
                            { $toInt: "$deliveryFee" },
                            Number(minFee)
                        ]
                    });
                }

                if (maxFee) {
                    conditions.push({
                        $lte: [
                            { $toInt: "$deliveryFee" },
                            Number(maxFee)
                        ]
                    });
                }

                query.$expr = {
                    $and: conditions
                };
            }

            // Filter by Availability
            if (availability) {
                query.status = availability;
            }

            const totalBooks = await bookcolloection.countDocuments(query);

            const books = await bookcolloection
                .find(query)
                .skip(skip)
                .limit(limit)
                .toArray();

           



            res.json({
                books,
                totalBooks,
                totalPages: Math.ceil(totalBooks / limit),
                currentPage: page
            });
        });

        // single book route
        app.get('/seller/books/:id', async (req, res) => {
            const { id } = req.params

            const result = await bookcolloection.findOne({ _id: new ObjectId(id) })
            res.json(result)
        })

        app.patch('/seller/books/:id', async (req, res) => {
            const { id } = req.params;
            const updatedData = req.body;

            const result = await bookcolloection.updateOne(
                {
                    _id: new ObjectId(id)
                },
                {
                    $set: updatedData
                }
            );

            res.json(result);
        });

        app.delete('/seller/books/:id', async (req, res) => {
            const { id } = req.params;

            const result = await bookcolloection.deleteOne({
                _id: new ObjectId(id)
            });

            res.json(result);
        });

        app.patch('/seller/books/publish-status/:id', async (req, res) => {
            const { id } = req.params;
            const { publishStatus } = req.body;

            const result = await bookcolloection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: { publishStatus }
                }
            );

            res.json(result);
        });

        // order collection for status update and payment info

        app.post("/seller/order", varyfitoken, async (req, res) => {
            const { price, productID, userId, userEmail, title } = req.body;
            console.log(price, userId, userEmail, title, productID)
            const book = await bookcolloection.findOne({
                _id: new ObjectId(productID)
            });
            const isExist = await ordercollection.findOne({ productID, userId });
            if (isExist) {
                return res.json({ msg: "Already exist!" });
            }

            await ordercollection.insertOne({
                price,
                userId,
                productID,
                userEmail,
                title,
                requestDate: new Date(),
                sellerId: book.sellerId,
                status: "Approved"
            });

            //update user role
            await bookcolloection.updateOne(
                { _id: new ObjectId(productID) },
                { $set: { status: "Checked Out" } },
            );

            res.json({ msg: "Payment successfull!" });
        });

        app.get('/seller/order', varyfitoken, async (req, res) => {
            const result = await ordercollection.find({ sellerId: req.user.id }).toArray()
            res.json(result)
        })
        app.get('/seller/order/user/:id', async (req, res) => {
            const { id } = req.params
            // console.log("Param ID:", id);
            const result = await ordercollection.find({ userId: id }).toArray()
            res.json(result)


        })


        app.patch('/seller/order/:id', async (req, res) => {
            const { id } = req.params
            const updatedata = req.body
            const order = await ordercollection.findOne({ _id: new ObjectId(id) });

            const result = await ordercollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updatedata }
            )
            if (order.productID) {
                const javascript = await bookcolloection.updateOne(
                    { _id: new ObjectId(order.productID) },
                    { $set: { status: updatedata.status } } // "Delivered" বা "Dispatched" বইয়েও সেভ হবে
                );
                // console.log(javascript, updatedata)
            }

            res.json({ success: true, modifiedCount: result.modifiedCount });


        })

        // review section
        // app.post('/review', async (req, res) => {
        //     const reviewdata = req.body


        app.post('/review', async (req, res) => {
            const { bookId, userId, rating, comment } = req.body;

            const deliveredOrder = await ordercollection.findOne({
                productID: bookId,
                userId: userId,
                status: "Delivered"
            });

            if (!deliveredOrder) {
                return res.status(403).json({
                    message: "You can review only delivered books"
                });
            }

            const reviewData = {
                bookId,
                userId,
                rating,
                comment,
                createdAt: new Date()
            };

            const result = await reviewsection.insertOne(reviewData);

            res.json(result);
        });

        app.get('/review', varyfitoken, async (req, res) => {
            const result = await reviewsection.find({ userId: req.user.id }).toArray()
            res.json(result)
        })
        // app.get('/review', async (req, res) => {
        //     const { bookId } = req.params

        //     const result = await reviewsection.find({ bookId: bookId }).toArray()
        //     res.json(result)
        // })

        app.patch('/review/:id', async (req, res) => {
            const { id } = req.params
            const updatedata = req.body

            const result = await reviewsection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updatedata }
            )
            res.json(result)
        })

        app.delete('/review/:id', async (req, res) => {
            const { id } = req.params

            const result = await reviewsection.deleteOne({ _id: new ObjectId(id) })
            res.json(result)
        })

        app.get('/review/:bookId', async (req, res) => {
            const { bookId } = req.params;

            const result = await reviewsection.find({
                bookId
            }).toArray();

            res.json(result);
        });


        // admin section

        app.get('/admin/books', varyfitoken, verifyAdmin, async (req, res) => {
            const books = await bookcolloection.find().toArray();
            res.json(books);
        });

        app.get('/admin/orders', varyfitoken, verifyAdmin, async (req, res) => {
            const orders = await ordercollection.find().toArray();
            res.json(orders);
        });
        app.get(
            '/admin/transactions',
            varyfitoken,
            verifyAdmin,
            async (req, res) => {
                const result = await ordercollection.find().toArray();
                res.json(result);
            }
        );

        app.get('/admin/pending-books', varyfitoken, verifyAdmin, async (req, res) => {
            const result = await bookcolloection
                .find({ status: "Pending Approval" })
                .toArray();

            res.json(result);
        });

        app.patch('/admin/book/approve/:id', varyfitoken, verifyAdmin, async (req, res) => {
            const { id } = req.params;

            const result = await bookcolloection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        status: "Approved",
                        publishStatus: "Published"
                    }
                }
            );

            res.json(result);
        });

        app.delete('/admin/book/:id', varyfitoken, verifyAdmin, async (req, res) => {
            const { id } = req.params;

            const result = await bookcolloection.deleteOne({
                _id: new ObjectId(id)
            });

            res.json(result);
        });

        // Manage user api
        app.get('/users', varyfitoken, verifyAdmin, async (req, res) => {

            const user = await usercollection.find().toArray()
            res.json(user)
        })

        app.patch("/users/role/:id", varyfitoken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const { role } = req.body;

            const result = await usercollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        role
                    }
                }
            );

            res.send(result);
        });


        app.delete("/users/:id", varyfitoken, verifyAdmin, async (req, res) => {
            const id = req.params.id;

            const result = await usercollection.deleteOne({
                _id: new ObjectId(id)
            });

            res.send(result);
        });

        // Manage All Books from admin

        app.patch('/admin/book/publish-status/:id', varyfitoken, verifyAdmin, async (req, res) => {
            const { id } = req.params;
            const { publishStatus } = req.body;

            const result = await bookcolloection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: { publishStatus }
                }
            );

            res.json(result);
        });

        // features section api
        app.get('/featured-books', async (req, res) => {
            const result = await bookcolloection
                .find({ publishStatus: "Published" })
                .sort({ createdAt: -1 })
                .limit(6)
                .toArray();

            res.json(result);
        });

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Server is running ver');
});



app.listen(PORT, () => {
    console.log(`Server is running on this port ${PORT}`)
})