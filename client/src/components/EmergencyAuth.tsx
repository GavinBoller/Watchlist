/**
 * Emergency Authentication Component
 * This component provides a last-resort direct authentication mechanism for when all other methods fail
 */

import React, { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { JwtAuthContext } from '../hooks/use-jwt-auth';
import { useToast } from '../hooks/use-toast';

interface EmergencyAuthProps {
  showDebug?: boolean;
}

// This component can be used anywhere in the app to enable emergency login
export const EmergencyAuth: React.FC<EmergencyAuthProps> = ({ showDebug = false }) => {
  const [loggedIn, setLoggedIn] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const authContext = React.useContext(JwtAuthContext);
  
  // Check for emergency login params on initial load
  useEffect(() => {
    // Check URL params for emergency login
    const url = new URL(window.location.href);
    const emergencyLogin = url.searchParams.get('emergencyLogin');
    const localAuth = url.searchParams.get('localAuth');
    const directAuth = url.searchParams.get('directAuth');
    const user = url.searchParams.get('user');
    
    // If any emergency param is present, try to authenticate
    if ((emergencyLogin || localAuth || directAuth) && user) {
      console.log(`[EMERGENCY] Detected emergency login for user: ${user}`);
      
      // Store emergency user info in sessionStorage (persists across page refreshes but not tabs)
      sessionStorage.setItem('emergency_user', user);
      sessionStorage.setItem('emergency_auth', 'true');
      sessionStorage.setItem('emergency_timestamp', Date.now().toString());
      
      // Try to update auth context if available
      if (authContext && !authContext.user) {
        // Create a minimal user object that matches expected structure
        const emergencyUser = {
          id: parseInt(sessionStorage.getItem('emergency_user_id') || '-999'),
          username: user,
          displayName: user,
          emergency: true
        };
        
        // This is a hack to update the auth context directly
        // @ts-ignore - We're doing this on purpose as a last resort
        if (typeof authContext._forceUpdateUser === 'function') {
          // @ts-ignore
          authContext._forceUpdateUser(emergencyUser);
          console.log('[EMERGENCY] Updated auth context with emergency user');
        }
        
        setUsername(user);
        setLoggedIn(true);
        
        // Show success message
        toast({
          title: `Emergency Authentication Active`,
          description: `You are now logged in as ${user} using emergency mode.`,
          variant: 'default'
        });
        
        // Remove URL params to avoid confusion
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } else {
      // Check if we have emergency auth in sessionStorage
      const storedEmergencyAuth = sessionStorage.getItem('emergency_auth');
      const storedEmergencyUser = sessionStorage.getItem('emergency_user');
      
      if (storedEmergencyAuth === 'true' && storedEmergencyUser) {
        console.log(`[EMERGENCY] Found stored emergency session for ${storedEmergencyUser}`);
        setUsername(storedEmergencyUser);
        setLoggedIn(true);
        
        // Try to update auth context if available
        if (authContext && !authContext.user) {
          // Create a minimal user object
          const emergencyUser = {
            id: parseInt(sessionStorage.getItem('emergency_user_id') || '-999'),
            username: storedEmergencyUser,
            displayName: storedEmergencyUser,
            emergency: true
          };
          
          // This is a hack to update the auth context directly
          // @ts-ignore - We're doing this on purpose as a last resort
          if (typeof authContext._forceUpdateUser === 'function') {
            // @ts-ignore
            authContext._forceUpdateUser(emergencyUser);
            console.log('[EMERGENCY] Updated auth context with emergency user from session');
          }
        }
      }
    }
  }, [navigate, toast, authContext]);

  // Only render debug info when needed
  if (!showDebug) return null;
  
  return (
    <div style={{ position: 'fixed', bottom: 10, right: 10, background: '#f0f0f0', padding: 10, borderRadius: 5, fontSize: 12, zIndex: 9999, opacity: 0.8 }}>
      <div><strong>Emergency Auth:</strong> {loggedIn ? 'Active' : 'Inactive'}</div>
      {username && <div><strong>Username:</strong> {username}</div>}
      <div><strong>Timestamp:</strong> {sessionStorage.getItem('emergency_timestamp') || 'None'}</div>
    </div>
  );
};

// Add emergency authentication methods to the window object for direct access
export function setupEmergencyAuth() {
  if (typeof window !== 'undefined') {
    // @ts-ignore - Adding emergency methods to window
    window.emergencyAuth = {
      login: (username: string) => {
        console.log(`[EMERGENCY] Manual emergency login for ${username}`);
        sessionStorage.setItem('emergency_user', username);
        sessionStorage.setItem('emergency_auth', 'true');
        sessionStorage.setItem('emergency_timestamp', Date.now().toString());
        window.location.href = `/?emergencyLogin=true&user=${username}&directAuth=true`;
      },
      // Method to login directly using the token you received from /api/emergency/raw-token/:username
      loginWithToken: (token: string, username: string) => {
        console.log(`[EMERGENCY] Direct token login for ${username}`);
        
        // Store token in localStorage and sessionStorage for redundancy
        localStorage.setItem('jwt_token', token);
        sessionStorage.setItem('jwt_token', token);
        
        // Set a cookie as another backup
        document.cookie = `jwt_token=${token}; path=/; max-age=${7*24*60*60}`;
        
        // Also store emergency data
        sessionStorage.setItem('emergency_user', username);
        sessionStorage.setItem('emergency_auth', 'true');
        sessionStorage.setItem('emergency_timestamp', Date.now().toString());
        
        // Redirect to home with emergency params
        window.location.href = `/?token=${token}&emergencyLogin=true&user=${username}&directAuth=true`;
      },
      logout: () => {
        console.log('[EMERGENCY] Manual emergency logout');
        localStorage.removeItem('jwt_token');
        sessionStorage.removeItem('jwt_token');
        sessionStorage.removeItem('emergency_user');
        sessionStorage.removeItem('emergency_auth');
        sessionStorage.removeItem('emergency_timestamp');
        
        // Clear cookie
        document.cookie = 'jwt_token=; path=/; max-age=0';
        
        window.location.href = '/auth';
      }
    };
  }
}

export default EmergencyAuth;