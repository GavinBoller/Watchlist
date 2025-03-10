import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useJwtAuth } from "@/hooks/use-jwt-auth";
import { Platform } from "@shared/schema";
import { 
  Trash2, 
  Plus, 
  Edit, 
  Check, 
  X
} from "lucide-react";

interface PlatformManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPlatformsUpdated: () => void;
}

export const PlatformManagementModal = ({ 
  isOpen, 
  onClose,
  onPlatformsUpdated 
}: PlatformManagementModalProps) => {
  const { user } = useJwtAuth();
  const { toast } = useToast();
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPlatform, setEditingPlatform] = useState<Platform | null>(null);
  const [newPlatform, setNewPlatform] = useState({
    name: '',
    logoUrl: '',
    isDefault: false
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  useEffect(() => {
    if (isOpen && user) {
      fetchPlatforms();
    }
  }, [isOpen, user]);
  
  // This component no longer needs to listen for the custom event directly
  // The WatchlistPage will handle that and set the isPlatformModalOpen state
  // which gets passed to this component via the isOpen prop

  const fetchPlatforms = async () => {
    if (!user) return;
    
    setLoading(true);
    setErrorMessage(null);
    
    try {
      const response = await apiRequest('GET', `/api/platforms/${user.id}`);
      const data = await response.json();
      setPlatforms(data);
    } catch (error) {
      console.error('Failed to fetch platforms:', error);
      setErrorMessage('Failed to load platforms. Please try again.');
      toast({
        title: 'Error',
        description: 'Failed to load platforms',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddPlatform = async () => {
    if (!user) return;
    if (!newPlatform.name.trim()) {
      setErrorMessage('Platform name is required');
      return;
    }
    
    setLoading(true);
    setErrorMessage(null);
    
    try {
      const platformData = {
        ...newPlatform,
        userId: user.id
      };
      
      await apiRequest('POST', '/api/platforms', platformData);
      
      setNewPlatform({
        name: '',
        logoUrl: '',
        isDefault: false
      });
      setAddingNew(false);
      fetchPlatforms();
      onPlatformsUpdated();
      toast({
        title: 'Success',
        description: 'Platform added successfully',
        variant: 'default'
      });
    } catch (error) {
      console.error('Failed to add platform:', error);
      setErrorMessage('Failed to add platform. Please try again.');
      toast({
        title: 'Error',
        description: 'Failed to add platform',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePlatform = async () => {
    if (!user || !editingPlatform) return;
    
    setLoading(true);
    setErrorMessage(null);
    
    try {
      await apiRequest('PUT', `/api/platforms/${editingPlatform.id}`, editingPlatform);
      
      setEditingPlatform(null);
      fetchPlatforms();
      onPlatformsUpdated();
      toast({
        title: 'Success',
        description: 'Platform updated successfully',
        variant: 'default'
      });
    } catch (error) {
      console.error('Failed to update platform:', error);
      setErrorMessage('Failed to update platform. Please try again.');
      toast({
        title: 'Error',
        description: 'Failed to update platform',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePlatform = async (id: number) => {
    if (!user) return;
    
    setLoading(true);
    setErrorMessage(null);
    
    try {
      await apiRequest('DELETE', `/api/platforms/${id}`);
      
      fetchPlatforms();
      onPlatformsUpdated();
      toast({
        title: 'Success',
        description: 'Platform deleted successfully',
        variant: 'default'
      });
    } catch (error) {
      console.error('Failed to delete platform:', error);
      setErrorMessage('Failed to delete platform. Please try again.');
      toast({
        title: 'Error',
        description: 'Failed to delete platform',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Streaming Platforms</DialogTitle>
          <DialogDescription>
            Add, edit, or remove streaming platforms to better organize your watchlist.
          </DialogDescription>
        </DialogHeader>
        
        {errorMessage && (
          <div className="mb-4 p-2 bg-red-50 text-red-600 rounded-md text-sm">
            {errorMessage}
          </div>
        )}

        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Platform list */}
          {platforms.length > 0 ? (
            <div className="space-y-4">
              {platforms.map(platform => (
                <div 
                  key={platform.id} 
                  className="flex items-center justify-between border p-3 rounded-md"
                >
                  {editingPlatform?.id === platform.id ? (
                    <div className="flex-1 space-y-2">
                      <div className="space-y-1">
                        <Label htmlFor="edit-name">Name</Label>
                        <Input 
                          id="edit-name"
                          value={editingPlatform.name} 
                          onChange={(e) => setEditingPlatform({
                            ...editingPlatform,
                            name: e.target.value
                          })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="edit-logo">Logo URL (optional)</Label>
                        <Input 
                          id="edit-logo"
                          value={editingPlatform.logoUrl || ''} 
                          onChange={(e) => setEditingPlatform({
                            ...editingPlatform,
                            logoUrl: e.target.value
                          })}
                        />
                      </div>
                      <div className="flex items-center space-x-2 pt-1">
                        <Switch 
                          checked={editingPlatform.isDefault === true} 
                          onCheckedChange={(checked) => setEditingPlatform({
                            ...editingPlatform,
                            isDefault: checked
                          })}
                        />
                        <Label htmlFor="edit-default">Make default platform</Label>
                      </div>
                      <div className="flex space-x-2 pt-2">
                        <Button 
                          size="sm" 
                          onClick={handleUpdatePlatform}
                          disabled={loading}
                        >
                          <Check className="h-4 w-4 mr-1" />
                          Save
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => setEditingPlatform(null)}
                        >
                          <X className="h-4 w-4 mr-1" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1">
                        <div className="font-medium">{platform.name}</div>
                        {platform.isDefault && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Default platform
                          </div>
                        )}
                      </div>
                      <div className="flex space-x-2">
                        <Button 
                          size="sm" 
                          variant="ghost"
                          onClick={() => setEditingPlatform(platform)}
                          disabled={loading}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => handleDeletePlatform(platform.id)}
                          disabled={loading}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : !loading ? (
            <div className="text-center py-4 text-muted-foreground">
              No platforms added yet. Add your first platform.
            </div>
          ) : null}

          {/* Add new platform form */}
          {addingNew ? (
            <div className="border p-3 rounded-md space-y-3">
              <h3 className="font-medium">Add New Platform</h3>
              <div className="space-y-1">
                <Label htmlFor="name">Name</Label>
                <Input 
                  id="name" 
                  value={newPlatform.name} 
                  onChange={(e) => setNewPlatform({
                    ...newPlatform,
                    name: e.target.value
                  })}
                  placeholder="e.g. Netflix, Prime Video"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="logo-url">Logo URL (optional)</Label>
                <Input 
                  id="logo-url" 
                  value={newPlatform.logoUrl} 
                  onChange={(e) => setNewPlatform({
                    ...newPlatform,
                    logoUrl: e.target.value
                  })}
                  placeholder="https://example.com/logo.png"
                />
              </div>
              <div className="flex items-center space-x-2 pt-1">
                <Switch 
                  id="default-platform"
                  checked={newPlatform.isDefault} 
                  onCheckedChange={(checked) => setNewPlatform({
                    ...newPlatform,
                    isDefault: checked
                  })}
                />
                <Label htmlFor="default-platform">Make default platform</Label>
              </div>
              <div className="flex space-x-2 pt-2">
                <Button 
                  size="sm" 
                  onClick={handleAddPlatform}
                  disabled={loading || !newPlatform.name.trim()}
                >
                  <Check className="h-4 w-4 mr-1" />
                  Add
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => setAddingNew(false)}
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button 
              className="w-full" 
              variant="outline"
              onClick={() => setAddingNew(true)}
              disabled={loading}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Platform
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button 
            variant="outline" 
            onClick={onClose}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};