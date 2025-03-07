import React from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { saveToken } from '@/lib/jwtUtils';

export function GetEmergencyTokenButton() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = React.useState(false);
  
  const handleClick = async () => {
    setIsLoading(true);
    
    try {
      console.log('[AUTH TEST] Attempting login for test user: Test82');
      console.log('[AUTH TEST] This login will try multiple pathways if needed:');
      console.log('[AUTH TEST] 1. Standard login via /api/jwt/emergency-token');
      console.log('[AUTH TEST] 2. Simple JWT login via /api/simple-jwt/emergency-token');
      
      // First try the standard emergency token endpoint
      try {
        console.log('[JWT] Attempting to get emergency token from primary endpoint');
        const response = await fetch('/api/jwt/emergency-token');
        
        if (response.ok) {
          const data = await response.json();
          if (data.token && data.user) {
            console.log('[JWT] Emergency token obtained successfully from primary endpoint');
            saveToken(data.token);
            
            toast({
              title: 'Emergency Token',
              description: `Successfully obtained token for ${data.user.username}`,
            });
            setIsLoading(false);
            return;
          }
        }
        console.log('[JWT] Primary endpoint failed, trying fallback...');
      } catch (primaryError) {
        console.error('[JWT] Primary endpoint error:', primaryError);
      }
      
      // If first attempt fails, try the simple JWT endpoint
      try {
        console.log('[JWT] Attempting to get emergency token from simple endpoint');
        const response = await fetch('/api/simple-jwt/emergency-token');
        
        if (response.ok) {
          const data = await response.json();
          if (data.token && data.user) {
            console.log('[JWT] Emergency token obtained successfully from simple endpoint');
            saveToken(data.token);
            
            toast({
              title: 'Emergency Token',
              description: `Successfully obtained token for ${data.user.username} (via backup)`,
            });
            setIsLoading(false);
            return;
          }
        }
        console.log('[JWT] Simple endpoint failed...');
        throw new Error('All emergency token endpoints failed');
      } catch (simpleError) {
        console.error('[JWT] Simple endpoint error:', simpleError);
        throw simpleError;
      }
    } catch (error) {
      console.error('[JWT] All emergency token attempts failed:', error);
      toast({
        title: 'Error',
        description: `Failed to get emergency token: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <Button 
      onClick={handleClick} 
      disabled={isLoading}
      variant="secondary"
      size="sm"
      className="mt-2"
    >
      {isLoading ? 'Loading...' : 'Get Emergency Token'}
    </Button>
  );
}