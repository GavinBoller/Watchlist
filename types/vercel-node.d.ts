declare module '@vercel/node' {
    import { IncomingMessage, ServerResponse } from 'http';
  
    export interface VercelRequest extends IncomingMessage {
      body: any;
      query: { [key: string]: string | string[] };
      cookies: { [key: string]: string };
      method: string;
    }
  
    export interface VercelResponse extends ServerResponse {
      status: (statusCode: number) => VercelResponse;
      json: (data: any) => VercelResponse;
      send: (data: any) => VercelResponse;
      redirect: (statusCode: number, url: string) => VercelResponse;
    }
  
    export default function handler(
      req: VercelRequest,
      res: VercelResponse
    ): void | Promise<void>;
  }