import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RecentSearchesService } from './recent-searches.service';
import { CreateRecentSearchDto } from './dto/create-recent-search.dto';
import { SearchType } from './entities/recent-search.entity';

import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';

@ApiTags('Búsquedas Recientes')
@ApiBearerAuth()
@Controller('recent-searches')
export class RecentSearchesController {
  constructor(private readonly recentSearchesService: RecentSearchesService) { }

  /**
   * POST /api/recent-searches
   * Guardar una nueva búsqueda reciente
   */
  @Post()
  @ApiOperation({ summary: 'Guardar una nueva búsqueda reciente' })
  @ApiBody({ type: CreateRecentSearchDto })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createRecentSearchDto: CreateRecentSearchDto) {
    return await this.recentSearchesService.create(createRecentSearchDto);
  }

  /**
   * GET /api/recent-searches/:username
   * Obtener búsquedas recientes de un usuario
   * Query params: limit (default: 20)
   */
  @Get(':username')
  @ApiOperation({ summary: 'Obtener búsquedas recientes de un usuario' })
  @ApiParam({ name: 'username' })
  @ApiQuery({ name: 'limit', required: false, description: 'Default: 20' })
  @ApiResponse({ status: 200, description: 'Lista de búsquedas' })
  async findByUsername(
    @Param('username') username: string,
    @Query('limit') limit?: number,
  ) {
    const searchLimit = limit ? parseInt(limit.toString(), 10) : 20;
    return await this.recentSearchesService.findByUsername(username, searchLimit);
  }

  /**
   * GET /api/recent-searches/:username/type/:searchType
   * Obtener búsquedas recientes por tipo
   * Query params: limit (default: 10)
   */
  @Get(':username/type/:searchType')
  async findByType(
    @Param('username') username: string,
    @Param('searchType') searchType: SearchType,
    @Query('limit') limit?: number,
  ) {
    const searchLimit = limit ? parseInt(limit.toString(), 10) : 10;
    return await this.recentSearchesService.findByUsernameAndType(
      username,
      searchType,
      searchLimit,
    );
  }

  /**
   * GET /api/recent-searches/:username/stats
   * Obtener estadísticas de búsquedas del usuario
   */
  @Get(':username/stats')
  async getStats(@Param('username') username: string) {
    return await this.recentSearchesService.getSearchStats(username);
  }

  /**
   * DELETE /api/recent-searches/:id
   * Eliminar una búsqueda específica
   * Body: { username: string }
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @Body('username') username: string) {
    await this.recentSearchesService.remove(parseInt(id, 10), username);
  }

  /**
   * DELETE /api/recent-searches/clear/:username
   * Limpiar todas las búsquedas de un usuario
   */
  @Delete('clear/:username')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearAll(@Param('username') username: string) {
    await this.recentSearchesService.clearAll(username);
  }

  /**
   * POST /api/recent-searches/clean-old
   * Limpiar búsquedas antiguas (admin)
   * Body: { daysOld?: number }
   */
  @Post('clean-old')
  @HttpCode(HttpStatus.OK)
  async cleanOld(@Body('daysOld') daysOld?: number) {
    const days = daysOld || 30;
    const deletedCount = await this.recentSearchesService.cleanOldSearches(days);
    return {
      message: `Búsquedas antiguas eliminadas`,
      deletedCount,
      daysOld: days,
    };
  }
}

