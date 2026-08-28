import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI as string;

export const connectDB = async (): Promise<void> => {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable not set');
  }
  try {
    await mongoose.connect(MONGODB_URI, {
      // Newer mongoose versions infer useNewUrlParser & useUnifiedTopology automatically
    });
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    // Exit the process – the app cannot run without a DB connection
    process.exit(1);
  }
};
