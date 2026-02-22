import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecentSearchesController } from 'src/02.-Services/recent-searches/recent-searches.controller';
import { RecentSearchesService } from 'src/02.-Services/recent-searches/recent-searches.service';
import { RecentSearch } from 'src/02.-Services/recent-searches/entities/recent-search.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([RecentSearch]),
  ],
  controllers: [RecentSearchesController],
  providers: [RecentSearchesService],
  exports: [RecentSearchesService],
})
export class RecentSearchesModule { }

