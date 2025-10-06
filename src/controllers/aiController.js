const { PrismaClient } = require('@prisma/client');
const aiService = require('../services/aiService');
const { AppError } = require('../utils/appError');
const { generateRecommendationReason, generateChatbotResponse } = require('../utils/helpers');

const prisma = new PrismaClient();

class AIController {
  // Get AI-powered project matches for volunteer
  async getMatches(req, res, next) {
    try {
      if (req.user.role !== 'VOLUNTEER') {
        throw new AppError('Only volunteers can access matches', 403);
      }

      const limit = parseInt(req.query.limit) || 10;
      const volunteerId = req.user.id;

      // Check if volunteer profile exists
      const volunteerProfile = await prisma.volunteerProfile.findUnique({
        where: { userId: volunteerId }
      });

      if (!volunteerProfile) {
        throw new AppError('Volunteer profile not found. Please complete your profile first.', 404);
      }

      const matches = await aiService.findMatches(volunteerId, limit);

      const processedMatches = matches.map(match => ({
        project: {
          id: match.project.id,
          title: match.project.title,
          description: match.project.description,
          shortDescription: match.project.shortDescription,
          category: match.project.category,
          location: match.project.location,
          startDate: match.project.startDate,
          endDate: match.project.endDate,
          volunteersNeeded: match.project.volunteersNeeded,
          volunteersApplied: match.project.volunteersApplied,
          estimatedHours: match.project.estimatedHours,
          images: match.project.images,
          tags: match.project.tags,
          creator: {
            id: match.project.creator.id,
            firstName: match.project.creator.firstName,
            lastName: match.project.creator.lastName,
            organizationProfile: match.project.creator.organizationProfile
          }
        },
        matchScore: Math.round(match.score * 100) / 100,
        matchFactors: {
          skills: Math.round(match.factors.skills * 100) / 100,
          location: Math.round(match.factors.location * 100) / 100,
          interests: Math.round(match.factors.interests * 100) / 100,
          availability: Math.round(match.factors.availability * 100) / 100,
          experience: Math.round(match.factors.experience * 100) / 100
        },
        recommendationReason: generateRecommendationReason(match)
      }));

      res.json({
        success: true,
        data: {
          matches: processedMatches,
          metadata: {
            totalMatches: matches.length,
            generatedAt: new Date().toISOString(),
            volunteerId
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  // Get AI recommendations for volunteers for a project
  async recommendVolunteers(req, res, next) {
    try {
      if (!['NGO', 'GOVERNMENT', 'ADMIN'].includes(req.user.role)) {
        throw new AppError('Only organizations can access volunteer recommendations', 403);
      }

      const { projectId } = req.params;
      const limit = parseInt(req.query.limit) || 10;

      // Verify project ownership
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { creator: true }
      });

      if (!project) {
        throw new AppError('Project not found', 404);
      }

      if (project.creatorId !== req.user.id && req.user.role !== 'ADMIN') {
        throw new AppError('Access denied. You can only get recommendations for your own projects.', 403);
      }

      const recommendations = await aiService.recommendVolunteers(projectId, limit);

      const processedRecommendations = recommendations.map(rec => ({
        volunteer: {
          id: rec.volunteer.userId,
          firstName: rec.volunteer.user.firstName,
          lastName: rec.volunteer.user.lastName,
          avatar: rec.volunteer.user.avatar,
          location: rec.volunteer.location,
          bio: rec.volunteer.bio,
          totalHours: rec.volunteer.totalHours,
          impactScore: rec.volunteer.impactScore,
          level: rec.volunteer.level,
          status: rec.volunteer.status,
          skills: rec.volunteer.skills.map(vs => ({
            name: vs.skill.name,
            category: vs.skill.category,
            level: vs.level,
            experience: vs.yearsOfExperience
          })),
          badges: rec.volunteer.badges.map(badge => ({
            name: badge.name,
            description: badge.description,
            iconUrl: badge.iconUrl
          }))
        },
        matchScore: Math.round(rec.score * 100) / 100,
        matchFactors: {
          skills: Math.round(rec.factors.skills * 100) / 100,
          location: Math.round(rec.factors.location * 100) / 100,
          interests: Math.round(rec.factors.interests * 100) / 100,
          availability: Math.round(rec.factors.availability * 100) / 100,
          experience: Math.round(rec.factors.experience * 100) / 100
        },
        recommendationReason: this.generateVolunteerRecommendationReason(rec)
      }));

      res.json({
        success: true,
        data: {
          recommendations: processedRecommendations,
          metadata: {
            projectId,
            projectTitle: project.title,
            totalRecommendations: recommendations.length,
            generatedAt: new Date().toISOString()
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  // Get volunteer engagement prediction and analysis
  async getEngagementAnalysis(req, res, next) {
    try {
      const { volunteerId } = req.params;

      // Check permissions
      if (req.user.id !== volunteerId && req.user.role !== 'ADMIN') {
        throw new AppError('Access denied', 403);
      }

      const analysis = await aiService.predictVolunteerEngagement(volunteerId);

      res.json({
        success: true,
        data: analysis,
        metadata: {
          analyzedAt: new Date().toISOString(),
          validFor: '24 hours'
        }
      });

    } catch (error) {
      next(error);
    }
  }

  // Get community needs assessment and insights
  async getCommunityInsights(req, res, next) {
    try {
      if (!['NGO', 'GOVERNMENT', 'ADMIN'].includes(req.user.role)) {
        throw new AppError('Access denied. Organizations and admins only.', 403);
      }

      const insights = await aiService.analyzeCommunityNeeds();

      // Get additional statistics
      const stats = await prisma.$transaction([
        prisma.project.count({ where: { status: 'ACTIVE' } }),
        prisma.volunteerProfile.count({ where: { status: 'AVAILABLE' } }),
        prisma.application.count({ where: { status: 'PENDING' } }),
        prisma.user.count({ where: { role: 'VOLUNTEER' } })
      ]);

      res.json({
        success: true,
        data: {
          insights,
          statistics: {
            activeProjects: stats[0],
            availableVolunteers: stats[1],
            pendingApplications: stats[2],
            totalVolunteers: stats[3]
          }
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          analysisType: 'community-needs-assessment'
        }
      });

    } catch (error) {
      next(error);
    }
  }

  // Update volunteer preferences for better matching
  async updatePreferences(req, res, next) {
    try {
      if (req.user.role !== 'VOLUNTEER') {
        throw new AppError('Only volunteers can update preferences', 403);
      }

      const { preferences } = req.body;
      const volunteerId = req.user.id;

      // Get volunteer profile
      const volunteerProfile = await prisma.volunteerProfile.findUnique({
        where: { userId: volunteerId }
      });

      if (!volunteerProfile) {
        throw new AppError('Volunteer profile not found', 404);
      }

      // Delete existing preferences
      await prisma.volunteerPreference.deleteMany({
        where: { volunteerId: volunteerProfile.id }
      });

      // Create new preferences
      const newPreferences = await prisma.volunteerPreference.createMany({
        data: preferences.map(pref => ({
          volunteerId: volunteerProfile.id,
          category: pref.category,
          value: pref.value,
          weight: pref.weight || 1.0
        }))
      });

      res.json({
        success: true,
        message: 'Preferences updated successfully',
        data: {
          preferencesUpdated: newPreferences.count
        }
      });

    } catch (error) {
      next(error);
    }
  }

  // Predict potential impact of a project
  async getImpactPrediction(req, res, next) {
    try {
      const { projectId } = req.params;

      if (!['NGO', 'GOVERNMENT', 'ADMIN'].includes(req.user.role)) {
        throw new AppError('Access denied', 403);
      }

      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          requiredSkills: {
            include: { skill: true }
          },
          applications: true,
          impactMetrics: true
        }
      });

      if (!project) {
        throw new AppError('Project not found', 404);
      }

      const prediction = await this.calculateImpactPrediction(project);

      res.json({
        success: true,
        data: prediction,
        metadata: {
          projectId,
          predictedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      next(error);
    }
  }

  // AI chatbot for assistance and guidance
  async chatbot(req, res, next) {
    try {
      const { message, context } = req.body;
      const userId = req.user.id;

      // Generate chatbot response
      const response = await generateChatbotResponse(message, context, req.user);

      // Log chatbot interaction for analytics
      await prisma.activityLog.create({
        data: {
          userId,
          action: 'CHATBOT_INTERACTION',
          entityType: 'CHATBOT',
          details: {
            message: message.substring(0, 100), // Truncate for privacy
            responseType: response.type
          }
        }
      });

      res.json({
        success: true,
        data: response
      });

    } catch (error) {
      next(error);
    }
  }

  // Get skills recommendations for volunteer
  async getSkillRecommendations(req, res, next) {
    try {
      if (req.user.role !== 'VOLUNTEER') {
        throw new AppError('Only volunteers can get skill recommendations', 403);
      }

      const volunteerId = req.user.id;

      // Get volunteer's current skills and interests
      const volunteer = await prisma.volunteerProfile.findUnique({
        where: { userId: volunteerId },
        include: {
          skills: {
            include: { skill: true }
          }
        }
      });

      if (!volunteer) {
        throw new AppError('Volunteer profile not found', 404);
      }

      // Find skills in demand but not possessed by volunteer
      const currentSkillIds = volunteer.skills.map(vs => vs.skillId);
      
      const demandingSkills = await prisma.skill.findMany({
        where: {
          NOT: { id: { in: currentSkillIds } },
          projectSkills: {
            some: {
              project: {
                status: 'ACTIVE',
                category: { in: volunteer.interests }
              }
            }
          }
        },
        include: {
          _count: {
            select: {
              projectSkills: {
                where: {
                  project: { status: 'ACTIVE' }
                }
              }
            }
          }
        },
        take: 10,
        orderBy: {
          projectSkills: {
            _count: 'desc'
          }
        }
      });

      const recommendations = demandingSkills.map(skill => ({
        skill: {
          id: skill.id,
          name: skill.name,
          category: skill.category,
          description: skill.description
        },
        demandScore: skill._count.projectSkills,
        reason: `This skill is required in ${skill._count.projectSkills} active projects in your areas of interest`
      }));

      res.json({
        success: true,
        data: {
          recommendations,
          metadata: {
            volunteerId,
            currentSkillsCount: volunteer.skills.length,
            generatedAt: new Date().toISOString()
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  // Helper methods
  generateVolunteerRecommendationReason(recommendation) {
    const factors = recommendation.factors;
    const reasons = [];

    if (factors.skills > 15) {
      reasons.push("Has required skills");
    }
    if (factors.location > 20) {
      reasons.push("Located nearby");
    }
    if (factors.experience > 8) {
      reasons.push("Experienced volunteer");
    }
    if (factors.availability > 12) {
      reasons.push("Available for commitment");
    }

    return reasons.length > 0 ? reasons.join(", ") : "Well-matched volunteer";
  }

  async calculateImpactPrediction(project) {
    // Simple impact prediction algorithm
    let impactScore = 50; // Base score

    // Factor in project characteristics
    if (project.volunteersNeeded > 10) impactScore += 15;
    if (project.estimatedHours > 40) impactScore += 10;
    if (project.requiredSkills.length > 3) impactScore += 5;

    // Factor in historical data if available
    const applicationRate = project.volunteersNeeded > 0 ? 
      (project.applications.length / project.volunteersNeeded) : 0;
    
    if (applicationRate > 0.8) impactScore += 10;
    else if (applicationRate > 0.5) impactScore += 5;

    // Categories that typically have higher impact
    const highImpactCategories = ['education', 'healthcare', 'environment', 'poverty'];
    if (highImpactCategories.includes(project.category.toLowerCase())) {
      impactScore += 10;
    }

    return {
      impactScore: Math.min(100, Math.max(0, impactScore)),
      factors: {
        projectSize: project.volunteersNeeded,
        duration: project.estimatedHours,
        complexity: project.requiredSkills.length,
        popularity: applicationRate,
        category: project.category
      },
      prediction: impactScore > 75 ? 'HIGH' : impactScore > 50 ? 'MEDIUM' : 'LOW',
      recommendations: this.generateImpactRecommendations(project, impactScore)
    };
  }

  generateImpactRecommendations(project, score) {
    const recommendations = [];

    if (score < 50) {
      recommendations.push("Consider adding more detailed project description");
      recommendations.push("Clarify the expected outcomes and impact");
    }

    if (project.volunteersApplied === 0) {
      recommendations.push("Promote the project through social media");
      recommendations.push("Reach out to volunteers with relevant skills");
    }

    if (project.requiredSkills.length === 0) {
      recommendations.push("Specify required skills to attract suitable volunteers");
    }

    return recommendations;
  }
}

module.exports = new AIController();