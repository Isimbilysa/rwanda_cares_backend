const express = require('express');
const projectController = require('../controllers/projectController');
const { authMiddleware, requireRole, optionalAuth } = require('../middleware/auth');
const { validateCreateProject, validateUpdateProject, validateApplication, validateQuery } = require('../middleware/validation');
const { uploadMiddleware } = require('../middleware/upload');

const router = express.Router();

// @route   GET /api/projects
// @desc    Get all projects with filtering and pagination
// @access  Public
router.get('/', optionalAuth, validateQuery, projectController.getAllProjects);

// @route   GET /api/projects/my
// @desc    Get my projects (for organizations)
// @access  Private (Organizations only)
router.get('/my', authMiddleware, requireRole(['NGO', 'GOVERNMENT']), projectController.getMyProjects);

// @route   GET /api/projects/applications/my
// @desc    Get my applications (for volunteers)
// @access  Private (Volunteers only)
router.get('/applications/my', authMiddleware, requireRole(['VOLUNTEER']), projectController.getMyApplications);

// @route   GET /api/projects/:id
// @desc    Get single project
// @access  Public
router.get('/:id', optionalAuth, projectController.getProject);

// @route   POST /api/projects
// @desc    Create new project
// @access  Private (Organizations only)
router.post('/', 
  authMiddleware, 
  requireRole(['NGO', 'GOVERNMENT']),
  uploadMiddleware.array('images', 5),
  validateCreateProject, 
  projectController.createProject
);

// @route   PUT /api/projects/:id
// @desc    Update project
// @access  Private (Project creator or admin)
router.put('/:id', authMiddleware, validateUpdateProject, projectController.updateProject);

// @route   DELETE /api/projects/:id
// @desc    Delete project
// @access  Private (Project creator or admin)
router.delete('/:id', authMiddleware, projectController.deleteProject);

// @route   POST /api/projects/:id/apply
// @desc    Apply for project
// @access  Private (Volunteers only)
router.post('/:id/apply', authMiddleware, requireRole(['VOLUNTEER']), validateApplication, projectController.applyForProject);

// @route   GET /api/projects/:id/applications
// @desc    Get project applications (for project creators)
// @access  Private (Project creator or admin)
router.get('/:id/applications', authMiddleware, projectController.getProjectApplications);

// @route   PUT /api/projects/applications/:applicationId/respond
// @desc    Respond to application
// @access  Private (Project creator or admin)
router.put('/applications/:applicationId/respond', authMiddleware, projectController.respondToApplication);

// @route   DELETE /api/projects/applications/:applicationId/withdraw
// @desc    Withdraw application
// @access  Private (Application owner)
router.delete('/applications/:applicationId/withdrawal', authMiddleware, projectController.withdrawApplication);

module.exports = router;