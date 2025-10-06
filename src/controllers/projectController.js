const { PrismaClient } = require('@prisma/client');
const { getDistance } = require('geolib');
const { AppError } = require('../utils/appError');
const { sendNotification } = require('../services/notificationService');
const { uploadImages } = require('../services/uploadService');
const aiService = require('../services/aiService');

const prisma = new PrismaClient();

class ProjectController {
  // Get all projects with filtering and pagination
  async getAllProjects(req, res, next) {
    try {
      const {
        page = 1,
        limit = 10,
        category,
        location,
        status = 'ACTIVE',
        search,
        skills,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        userLat,
        userLng,
        radius
      } = req.query;

      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Build filter conditions
      const where = { status };

      if (category) {
        where.category = { contains: category, mode: 'insensitive' };
      }

      if (location) {
        where.location = { contains: location, mode: 'insensitive' };
      }

      if (search) {
        where.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { tags: { hasSome: [search] } }
        ];
      }

      if (skills) {
        const skillIds = skills.split(',');
        where.requiredSkills = {
          some: { skillId: { in: skillIds } }
        };
      }

      // Build order by
      const orderBy = {};
      orderBy[sortBy] = sortOrder;

      const [projects, totalCount] = await Promise.all([
        prisma.project.findMany({
          where,
          include: {
            creator: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                organizationProfile: {
                  select: {
                    organizationName: true,
                    organizationType: true,
                    isVerified: true
                  }
                }
              }
            },
            requiredSkills: {
              include: { skill: true }
            },
            _count: {
              select: {
                applications: true,
                events: true
              }
            }
          },
          orderBy,
          skip,
          take: parseInt(limit)
        }),
        prisma.project.count({ where })
      ]);

      // Add distance if user location provided
      let processedProjects = projects;
      if (userLat && userLng) {
        processedProjects = projects.map(project => {
          if (project.latitude && project.longitude) {
            const distance = getDistance(
              { latitude: parseFloat(userLat), longitude: parseFloat(userLng) },
              { latitude: project.latitude, longitude: project.longitude }
            ) / 1000; // Convert to km

            return { ...project, distance: Math.round(distance * 10) / 10 };
          }
          return project;
        });

        // Filter by radius if specified
        if (radius) {
          processedProjects = processedProjects.filter(
            project => !project.distance || project.distance <= parseInt(radius)
          );
        }
      }

      const totalPages = Math.ceil(totalCount / parseInt(limit));

      res.json({
        success: true,
        data: {
          projects: processedProjects,
          pagination: {
            currentPage: parseInt(page),
            totalPages,
            totalItems: totalCount,
            itemsPerPage: parseInt(limit),
            hasNext: parseInt(page) < totalPages,
            hasPrev: parseInt(page) > 1
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  // Get single project
  async getProject(req, res, next) {
    try {
      const { id } = req.params;

      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          creator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
              organizationProfile: true
            }
          },
          requiredSkills: {
            include: { skill: true }
          },
          applications: {
            where: { status: 'ACCEPTED' },
            include: {
              volunteer: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  avatar: true
                }
              }
            }
          },
          events: {
            where: {
              status: { in: ['UPCOMING', 'ONGOING'] }
            },
            orderBy: { startTime: 'asc' }
          },
          impactMetrics: true,
          _count: {
            select: {
              applications: true,
              events: true
            }
          }
        }
      });

      if (!project) {
        throw new AppError('Project not found', 404);
      }

      // Check if current user has applied (if authenticated)
      let hasApplied = false;
      if (req.user && req.user.role === 'VOLUNTEER') {
        const application = await prisma.application.findUnique({
          where: {
            volunteerId_projectId: {
              volunteerId: req.user.id,
              projectId: id
            }
          }
        });
        hasApplied = !!application;
      }

      res.json({
        success: true,
        data: {
          ...project,
          hasApplied
        }
      });

    } catch (error) {
      next(error);
    }
  }

  // Create new project
  async createProject(req, res, next) {
    try {
      const {
        title,
        description,
        shortDescription,
        category,
        location,
        latitude,
        longitude,
        startDate,
        endDate,
        volunteersNeeded,
        estimatedHours,
        priority = 'MEDIUM',
        requiredSkills = [],
        tags = []
      } = req.body;

      const creatorId = req.user.id;

      // Create project
      const project = await prisma.project.create({
        data: {
          title,
          description,
          shortDescription,
          category,
          location,
          latitude: latitude ? parseFloat(latitude) : null,
          longitude: longitude ? parseFloat(longitude) : null,
          startDate: new Date(startDate),
          endDate: endDate ? new Date(endDate) : null,
          volunteersNeeded: parseInt(volunteersNeeded),
          estimatedHours: estimatedHours ? parseInt(estimatedHours) : null,
          priority,
          tags,
          creatorId,
          requiredSkills: {
            create: requiredSkills.map(skill => ({
              skillId: skill.skillId,
              requiredLevel: skill.level || 'BEGINNER',
              isRequired: skill.isRequired !== false
            }))
          }
        },
        include: {
          creator: {
            select: {
              firstName: true,
              lastName: true,
              organizationProfile: true
            }
          },
          requiredSkills: {
            include: { skill: true }
          }
        }
      });

      // Handle image uploads if provided
      if (req.files && req.files.length > 0) {
        const imageUrls = await uploadImages(req.files, 'projects');
        await prisma.project.update({
          where: { id: project.id },
          data: { images: imageUrls }
        });
        project.images = imageUrls;
      }

      // Send notifications to relevant volunteers
      await this.notifyRelevantVolunteers(project);

      res.status(201).json({
        success: true,
        message: 'Project created successfully',
        data: project
      });

    } catch (error) {
      next(error);
    }
  }

  // Update project
  async updateProject(req, res, next) {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Check if project exists and user has permission
      const existingProject = await prisma.project.findUnique({
        where: { id },
        include: { creator: true }
      });

      if (!existingProject) {
        throw new AppError('Project not found', 404);
      }

      if (existingProject.creatorId !== req.user.id && req.user.role !== 'ADMIN') {
        throw new AppError('Access denied. You can only update your own projects.', 403);
      }

      // Prepare update data
      const updateData = {};
      const allowedFields = [
        'title', 'description', 'shortDescription', 'category', 'location',
        'latitude', 'longitude', 'startDate', 'endDate', 'volunteersNeeded',
        'estimatedHours', 'priority', 'tags', 'status'
      ];

      allowedFields.forEach(field => {
        if (updates[field] !== undefined) {
          if (['startDate', 'endDate'].includes(field) && updates[field]) {
            updateData[field] = new Date(updates[field]);
          } else if (['latitude', 'longitude'].includes(field)) {
            updateData[field] = updates[field] ? parseFloat(updates[field]) : null;
          } else if (['volunteersNeeded', 'estimatedHours'].includes(field)) {
            updateData[field] = parseInt(updates[field]);
          } else {
            updateData[field] = updates[field];
          }
        }
      });

      const updatedProject = await prisma.project.update({
        where: { id },
        data: updateData,
        include: {
          creator: {
            select: {
              firstName: true,
              lastName: true,
              organizationProfile: true
            }
          },
          requiredSkills: {
            include: { skill: true }
          }
        }
      });

      res.json({
        success: true,
        message: 'Project updated successfully',
        data: updatedProject
      });

    } catch (error) {
      next(error);
    }
  }

  // Delete project
  async deleteProject(req, res, next) {
    try {
      const { id } = req.params;

      const project = await prisma.project.findUnique({
        where: { id },
        include: { creator: true }
      });

      if (!project) {
        throw new AppError('Project not found', 404);
      }

      if (project.creatorId !== req.user.id && req.user.role !== 'ADMIN') {
        throw new AppError('Access denied. You can only delete your own projects.', 403);
      }

      // Notify applied volunteers about project deletion
      const applications = await prisma.application.findMany({
        where: { projectId: id },
        include: { volunteer: true }
      });

      await prisma.project.delete({
        where: { id }
      });

      // Send deletion notifications
      for (const application of applications) {
        await sendNotification({
          userId: application.volunteerId,
          type: 'PROJECT_DELETED',
          title: 'Project Cancelled',
          message: `The project "${project.title}" has been cancelled.`,
          data: { projectId: id }
        });
      }

      res.json({
        success: true,
        message: 'Project deleted successfully'
      });

    } catch (error) {
      next(error);
    }
  }

  // Apply for project
  async applyForProject(req, res, next) {
    try {
      const { id: projectId } = req.params;
      const { message, estimatedHours } = req.body;
      const volunteerId = req.user.id;

      if (req.user.role !== 'VOLUNTEER') {
        throw new AppError('Only volunteers can apply for projects', 403);
      }

      // Check if project exists and is active
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { creator: true }
      });

      if (!project) {
        throw new AppError('Project not found', 404);
      }

      if (project.status !== 'ACTIVE') {
        throw new AppError('This project is no longer accepting applications', 400);
      }

      // Check if already applied
      const existingApplication = await prisma.application.findUnique({
        where: {
          volunteerId_projectId: {
            volunteerId,
            projectId
          }
        }
      });

      if (existingApplication) {
        throw new AppError('You have already applied for this project', 400);
      }

      // Create application
      const application = await prisma.application.create({
        data: {
          volunteerId,
          projectId,
          message,
          estimatedHours: estimatedHours ? parseInt(estimatedHours) : null
        },
        include: {
          volunteer: {
            select: {
              firstName: true,
              lastName: true,
              avatar: true,
              volunteerProfile: {
                include: {
                  skills: {
                    include: { skill: true }
                  }
                }
              }
            }
          },
          project: {
            select: {
              title: true,
              creator: true
            }
          }
        }
      });

      // Update project application count
      await prisma.project.update({
        where: { id: projectId },
        data: {
          volunteersApplied: {
            increment: 1
          }
        }
      });

      // Notify project creator
      await sendNotification({
        userId: project.creatorId,
        type: 'NEW_APPLICATION',
        title: 'New Volunteer Application',
        message: `${application.volunteer.firstName} ${application.volunteer.lastName} has applied for your project "${project.title}"`,
        data: {
          projectId,
          applicationId: application.id,
          volunteerId
        }
      });

      res.status(201).json({
        success: true,
        message: 'Application submitted successfully',
        data: application
      });

    } catch (error) {
      next(error);
    }
  }

  // Get project applications (for project creators)
  async getProjectApplications(req, res, next) {
    try {
      const { id: projectId } = req.params;
      const { status, page = 1, limit = 10 } = req.query;

      const project = await prisma.project.findUnique({
        where: { id: projectId }
      });

      if (!project) {
        throw new AppError('Project not found', 404);
      }

      if (project.creatorId !== req.user.id && req.user.role !== 'ADMIN') {
        throw new AppError('Access denied', 403);
      }

      const where = { projectId };
      if (status) {
        where.status = status;
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [applications, totalCount] = await Promise.all([
        prisma.application.findMany({
          where,
          include: {
            volunteer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                avatar: true,
                volunteerProfile: {
                  include: {
                    skills: {
                      include: { skill: true }
                    }
                  }
                }
              }
            }
          },
          orderBy: { appliedAt: 'desc' },
          skip,
          take: parseInt(limit)
        }),
        prisma.application.count({ where })
      ]);

      res.json({
        success: true,
        data: {
          applications,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalCount / parseInt(limit)),
            totalItems: totalCount,
            itemsPerPage: parseInt(limit)
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  // Respond to application
  async respondToApplication(req, res, next) {
    try {
      const { applicationId } = req.params;
      const { status, message } = req.body;

      const application = await prisma.application.findUnique({
        where: { id: applicationId },
        include: {
          project: true,
          volunteer: {
            select: {
              firstName: true,
              lastName: true
            }
          }
        }
      });

      if (!application) {
        throw new AppError('Application not found', 404);
      }

      if (application.project.creatorId !== req.user.id && req.user.role !== 'ADMIN') {
        throw new AppError('Access denied', 403);
      }

      // Update application status
      const updatedApplication = await prisma.application.update({
        where: { id: applicationId },
        data: {
          status,
          reviewedAt: new Date()
        }
      });

      // Send notification to volunteer
      const notificationTitle = status === 'ACCEPTED' ? 'Application Accepted!' : 'Application Update';
      const notificationMessage = status === 'ACCEPTED' 
        ? `Congratulations! Your application for "${application.project.title}" has been accepted.`
        : `Your application for "${application.project.title}" has been ${status.toLowerCase()}.`;

      await sendNotification({
        userId: application.volunteerId,
        type: 'APPLICATION_UPDATE',
        title: notificationTitle,
        message: notificationMessage + (message ? ` Message: ${message}` : ''),
        data: {
          projectId: application.projectId,
          applicationId,
          status
        }
      });

      res.json({
        success: true,
        message: `Application ${status.toLowerCase()} successfully`,
        data: updatedApplication
      });

    } catch (error) {
      next(error);
    }
  }

  // Get my projects (for organizations)
  async getMyProjects(req, res, next) {
    try {
      const { status, page = 1, limit = 10 } = req.query;
      const creatorId = req.user.id;

      const where = { creatorId };
      if (status) {
        where.status = status;
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [projects, totalCount] = await Promise.all([
        prisma.project.findMany({
          where,
          include: {
            requiredSkills: {
              include: { skill: true }
            },
            _count: {
              select: {
                applications: true,
                events: true
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: parseInt(limit)
        }),
        prisma.project.count({ where })
      ]);

      res.json({
        success: true,
        data: {
          projects,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalCount / parseInt(limit)),
            totalItems: totalCount,
            itemsPerPage: parseInt(limit)
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  // Get my applications (for volunteers)
  async getMyApplications(req, res, next) {
    try {
      const { status, page = 1, limit = 10 } = req.query;
      const volunteerId = req.user.id;

      if (req.user.role !== 'VOLUNTEER') {
        throw new AppError('Only volunteers can view applications', 403);
      }

      const where = { volunteerId };
      if (status) {
        where.status = status;
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [applications, totalCount] = await Promise.all([
        prisma.application.findMany({
          where,
          include: {
            project: {
              include: {
                creator: {
                  select: {
                    firstName: true,
                    lastName: true,
                    organizationProfile: true
                  }
                }
              }
            }
          },
          orderBy: { appliedAt: 'desc' },
          skip,
          take: parseInt(limit)
        }),
        prisma.application.count({ where })
      ]);

      res.json({
        success: true,
        data: {
          applications,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalCount / parseInt(limit)),
            totalItems: totalCount,
            itemsPerPage: parseInt(limit)
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  // Withdraw application
  async withdrawApplication(req, res, next) {
    try {
      const { applicationId } = req.params;
      const volunteerId = req.user.id;

      if (req.user.role !== 'VOLUNTEER') {
        throw new AppError('Only volunteers can withdraw applications', 403);
      }

      const application = await prisma.application.findUnique({
        where: { id: applicationId },
        include: { project: true }
      });

      if (!application) {
        throw new AppError('Application not found', 404);
      }

      if (application.volunteerId !== volunteerId) {
        throw new AppError('Access denied', 403);
      }

      if (application.status === 'ACCEPTED') {
        throw new AppError('Cannot withdraw an accepted application. Please contact the organization.', 400);
      }

      // Delete application
      await prisma.application.delete({
        where: { id: applicationId }
      });

      // Update project application count
      await prisma.project.update({
        where: { id: application.projectId },
        data: {
          volunteersApplied: {
            decrement: 1
          }
        }
      });

      // Notify project creator
      await sendNotification({
        userId: application.project.creatorId,
        type: 'APPLICATION_WITHDRAWN',
        title: 'Application Withdrawn',
        message: `A volunteer has withdrawn their application for "${application.project.title}"`,
        data: {
          projectId: application.projectId,
          applicationId
        }
      });

      res.json({
        success: true,
        message: 'Application withdrawn successfully'
      });

    } catch (error) {
      next(error);
    }
  }

  // Get project statistics
  async getProjectStats(req, res, next) {
    try {
      const { id: projectId } = req.params;

      const project = await prisma.project.findUnique({
        where: { id: projectId }
      });

      if (!project) {
        throw new AppError('Project not found', 404);
      }

      if (project.creatorId !== req.user.id && req.user.role !== 'ADMIN') {
        throw new AppError('Access denied', 403);
      }

      const stats = await prisma.$transaction([
        prisma.application.count({ where: { projectId } }),
        prisma.application.count({ where: { projectId, status: 'PENDING' } }),
        prisma.application.count({ where: { projectId, status: 'ACCEPTED' } }),
        prisma.application.count({ where: { projectId, status: 'REJECTED' } }),
        prisma.event.count({ where: { projectId } }),
        prisma.impactMetric.findMany({ 
          where: { projectId },
          orderBy: { recordedAt: 'desc' }
        })
      ]);

      const [
        totalApplications,
        pendingApplications,
        acceptedApplications,
        rejectedApplications,
        totalEvents,
        impactMetrics
      ] = stats;

      res.json({
        success: true,
        data: {
          applications: {
            total: totalApplications,
            pending: pendingApplications,
            accepted: acceptedApplications,
            rejected: rejectedApplications
          },
          events: {
            total: totalEvents
          },
          impact: {
            metrics: impactMetrics
          },
          project: {
            volunteersNeeded: project.volunteersNeeded,
            volunteersApplied: project.volunteersApplied,
            fillRate: project.volunteersNeeded > 0 ? 
              (acceptedApplications / project.volunteersNeeded) * 100 : 0
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  // Helper method to notify relevant volunteers about new projects
  async notifyRelevantVolunteers(project) {
    try {
      // Use AI service to find potential matches
      const potentialVolunteers = await aiService.recommendVolunteers(project.id, 20);
      
      // Send notifications to top matches
      const topMatches = potentialVolunteers.slice(0, 5);
      
      for (const match of topMatches) {
        await sendNotification({
          userId: match.volunteer.userId,
          type: 'NEW_PROJECT_MATCH',
          title: 'New Project Match!',
          message: `A new project "${project.title}" matches your skills and interests!`,
          data: {
            projectId: project.id,
            matchScore: Math.round(match.score)
          }
        });
      }
    } catch (error) {
      console.error('Error notifying volunteers:', error);
      // Don't throw error as this is not critical
    }
  }
}

module.exports = new ProjectController();