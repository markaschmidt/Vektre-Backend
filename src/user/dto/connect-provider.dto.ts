import { IsString } from 'class-validator';

export class ConnectProviderDto {
  @IsString()
  provider!: string;
}
