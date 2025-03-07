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
      console.log('[JWT] Attempting to get emergency token');
      const response = await fetch('/api/jwt/emergency-token');
      
      if (!response.ok) {
        throw new Error(`Failed to get emergency token: ${response.status}`);
      }
      
      const data = await response.json();
      if (data.token && data.user) {
        console.log('[JWT] Emergency token obtained successfully');
        saveToken(data.token);
        
        toast({
          title: 'Emergency Token',
          description: `Successfully obtained token for ${data.user.username}`,
        });
      } else {
        throw new Error('Invalid emergency token response');
      }
    } catch (error) {
      console.error('[JWT] Emergency token error:', error);
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