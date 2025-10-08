const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { sendEmail } = require('../services/emailService');
const { generateToken, generateVerificationToken } = require('../utils/helper');
const { AppError } = require('../utils/appError');

const prisma = new PrismaClient();

class AuthController {
  register = async (req, res, next) => {
    try {
      const { email, password, firstname, lastname, role } = req.body;

      if (!email || !password || !firstname || !lastname) {
        throw new AppError('Email, password, firstname, and lastname are required', 400);
      }

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) throw new AppError('User already exists with this email', 400);

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 12);

      // Generate verification token
      const verificationToken = generateVerificationToken();

      // Create user
      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          firstname,
          lastname,
          role,
          verificationToken,
          skills: [],
          interests: [],
          location: ''
        }
      });

      // Send verification email
      await this.sendVerificationEmail(user, verificationToken);

      // Generate JWT token
      const token = generateToken(user.id, user.role);

      res.status(201).json({
        success: true,
        message: 'User registered successfully. Please check your email to verify your account.',
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            firstname: user.firstname,
            lastname: user.lastname,
            role: user.role,
            isVerified: user.isVerified || false
          }
        }
      });
    } catch (error) {
      next(error);
    }
  };

  // Login user
  login = async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) throw new AppError('Invalid credentials', 401);

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) throw new AppError('Invalid credentials', 401);

      const token = generateToken(user.id, user.role);

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            firstname: user.firstname,
            lastname: user.lastname,
            role: user.role,
            isVerified: user.isVerified || false
          }
        }
      });
    } catch (error) {
      next(error);
    }
  };

  // Verify email
  verifyEmail = async (req, res, next) => {
    try {
      const { token } = req.body;
      const user = await prisma.user.findFirst({ where: { verificationToken: token } });
      if (!user) throw new AppError('Invalid or expired verification token', 400);

      await prisma.user.update({
        where: { id: user.id },
        data: { isVerified: true, verificationToken: null }
      });

      res.json({ success: true, message: 'Email verified successfully' });
    } catch (error) {
      next(error);
    }
  };

  // Change password
  changePassword = async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.user.id;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) throw new AppError('Current password is incorrect', 400);

      const hashedPassword = await bcrypt.hash(newPassword, 12);
      await prisma.user.update({ where: { id: userId }, data: { password: hashedPassword } });

      res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
      next(error);
    }
  };

  // Get current user
  getMe = async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          id: true,
          email: true,
          firstname: true,
          lastname: true,
          role: true,
          isVerified: true,
          skills: true,
          interests: true,
          location: true,
          createdAt: true,
          updatedAt: true
        }
      });

      if (!user) throw new AppError('User not found', 404);
      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  };

  // Refresh token
  refreshToken = async (req, res, next) => {
    try {
      const user = req.user;
      const newToken = generateToken(user.id, user.role);
      res.json({ success: true, message: 'Token refreshed successfully', data: { token: newToken } });
    } catch (error) {
      next(error);
    }
  };

  // Logout
  logout = async (req, res, next) => {
    res.json({ success: true, message: 'Logout successful' });
  };

  // Delete account
  deleteAccount = async (req, res, next) => {
    try {
      const { password } = req.body;
      const userId = req.user.id;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) throw new AppError('Incorrect password', 400);

      await prisma.user.delete({ where: { id: userId } });
      res.json({ success: true, message: 'Account deleted successfully' });
    } catch (error) {
      next(error);
    }
  };

  // Email sending
  sendVerificationEmail = async (user, token) => {
    const verificationUrl = `${process.env.CLIENT_URL}/verify-email?token=${token}`;
    await sendEmail({
      to: user.email,
      subject: 'Welcome to RwandaCares - Verify Your Email',
      template: 'welcome',
      context: { name: user.firstname, verificationUrl }
    });
  };
}

module.exports = new AuthController();
