import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.model.js';
import { ProjectsService } from './projects.service.js';
import { AssetsService } from './assets.service.js';
import {
  CreateProjectDto,
  UpdateProjectDto,
  UpdateProjectMemberDto,
  UpsertProjectAssetDto,
  UpsertProjectMemberDto,
  UploadProjectAssetDto,
  UploadProjectAssetChunkDto,
  ImportGeneratedAssetDto,
} from './dto/project.dto.js';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly assetsService: AssetsService,
  ) {}

  @Get()
  listProjects(@CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.listProjects(user.id);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  createProject(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsService.createProject(user.id, dto);
  }

  @Get(':projectId')
  getProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ) {
    return this.projectsService.getProject(user.id, projectId);
  }

  @Patch(':projectId')
  @HttpCode(HttpStatus.ACCEPTED)
  updateProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.updateProject(user.id, projectId, dto);
  }

  @Post(':projectId/archive')
  @HttpCode(HttpStatus.ACCEPTED)
  archiveProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ) {
    return this.projectsService.archiveProject(user.id, projectId);
  }

  @Delete(':projectId')
  @HttpCode(HttpStatus.ACCEPTED)
  deleteProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ) {
    return this.projectsService.deleteProject(user.id, projectId);
  }

  @Get(':projectId/members')
  listMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ) {
    return this.projectsService.listMembers(user.id, projectId);
  }

  @Post(':projectId/members')
  @HttpCode(HttpStatus.ACCEPTED)
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() dto: UpsertProjectMemberDto,
  ) {
    return this.projectsService.addMember(user.id, projectId, dto);
  }

  @Patch(':projectId/members/:memberUserId')
  @HttpCode(HttpStatus.ACCEPTED)
  updateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('memberUserId') memberUserId: string,
    @Body() dto: UpdateProjectMemberDto,
  ) {
    return this.projectsService.updateMember(
      user.id,
      projectId,
      memberUserId,
      dto,
    );
  }

  @Delete(':projectId/members/:memberUserId')
  @HttpCode(HttpStatus.ACCEPTED)
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('memberUserId') memberUserId: string,
  ) {
    return this.projectsService.removeMember(user.id, projectId, memberUserId);
  }

  @Get(':projectId/assets')
  listAssets(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ) {
    return this.projectsService.listAssets(user.id, projectId);
  }

  @Post(':projectId/assets')
  @HttpCode(HttpStatus.ACCEPTED)
  upsertAsset(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() dto: UpsertProjectAssetDto,
  ) {
    return this.projectsService.upsertAsset(user.id, projectId, dto);
  }

  @Patch(':projectId/assets/:assetId')
  @HttpCode(HttpStatus.ACCEPTED)
  updateAsset(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('assetId') assetId: string,
    @Body() dto: UpsertProjectAssetDto,
  ) {
    return this.projectsService.upsertAsset(user.id, projectId, {
      ...dto,
      assetId,
    });
  }

  @Delete(':projectId/assets/:assetId')
  @HttpCode(HttpStatus.ACCEPTED)
  removeAsset(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('assetId') assetId: string,
  ) {
    return this.projectsService.removeAsset(user.id, projectId, assetId);
  }

  // ─── Storage Orchestration ────────────────────────────────────────────────

  /**
   * Store an asset directly in Supabase Storage.
   */
  @Post(':projectId/assets/upload')
  @HttpCode(HttpStatus.CREATED)
  uploadAsset(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() dto: UploadProjectAssetDto,
  ) {
    return this.assetsService.uploadAsset(user.id, projectId, dto);
  }

  /**
   * Append or replace one Supabase Storage chunk for an asset.
   */
  @Post(':projectId/assets/:assetId/chunks')
  @HttpCode(HttpStatus.CREATED)
  uploadAssetChunk(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('assetId') assetId: string,
    @Body() dto: UploadProjectAssetChunkDto,
  ) {
    return this.assetsService.uploadAssetChunk(user.id, projectId, assetId, dto);
  }

  /**
   * Read an asset from Supabase Storage as base64.
   */
  @Get(':projectId/assets/:assetId/bytes')
  getAssetBytes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('assetId') assetId: string,
  ) {
    return this.assetsService.getAssetBytes(user.id, projectId, assetId);
  }

  /**
   * Server-side import a generated asset (Replicate GLB, OpenAI PNG) into
   * Supabase Storage.
   */
  @Post(':projectId/assets/import-generated')
  @HttpCode(HttpStatus.CREATED)
  importGeneratedAsset(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() dto: ImportGeneratedAssetDto,
  ) {
    return this.assetsService.importGeneratedAsset(user.id, projectId, dto);
  }
}
