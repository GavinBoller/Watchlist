import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { isAuthenticated, setAuthHeader } from "@/lib/jwtUtils";
import { isProductionEnvironment } from "@/lib/environment-utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistance } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useLocation } from "wouter";

// Types
interface TopUser {
  id: number;
  username: string;
  display_name: string | null;
  entry_count: string;
  database_environment?: 'development' | 'production';
}

interface UserActivity {
  id: number;
  username: string;
  display_name: string | null;
  watchlist_count: number;
  last_login: string | null;
  last_activity: string | null;
  last_seen: string | null;
  database_environment?: 'development' | 'production';
}

interface RecentRegistration {
  username: string;
  display_name: string | null;
  created_at: string;
  database_environment?: 'development' | 'production';
}

interface RecentActivity {
  username: string;
  title: string;
  created_at: string;
  status: 'to_watch' | 'watching' | 'watched';
  database_environment?: 'development' | 'production';
}

interface SystemStats {
  status: string;
  timestamp: string;
  environment: 'development' | 'production';
  stats: {
    users: {
      total: number;
      topUsers: TopUser[];
      userActivity: UserActivity[];
    };
    content: {
      movies: number;
      tvShows: number; // Added TV shows count
      watchlistEntries: number;
      platforms: number;
    };
    system: {
      database: {
        connected: boolean;
        lastChecked: string;
      };
      sessions: number;
    };
  };
}

interface UserActivityData {
  status: string;
  timestamp: string;
  recentRegistrations: RecentRegistration[];
  recentActivity: RecentActivity[];
}

const AdminDashboardPage = () => {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [activityData, setActivityData] = useState<UserActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const authenticated = await isAuthenticated();
      if (!authenticated) {
        toast({
          title: "Access Denied",
          description: "You must be logged in to view this page.",
          variant: "destructive",
        });
        setLocation("/");
        return false;
      }
      return true;
    };

    const fetchStats = async () => {
      setLoading(true);
      setError(null);
      try {
        const isAuthed = await checkAuth();
        if (!isAuthed) return;

        // Fetch system stats
        const statsResponse = await fetch("/api/status/stats", {
          headers: setAuthHeader(),
        });
        
        if (!statsResponse.ok) {
          if (statsResponse.status === 403) {
            toast({
              title: "Access Denied",
              description: "You don't have permission to access the admin dashboard.",
              variant: "destructive",
            });
            setLocation("/");
            return;
          }
          throw new Error(`Failed to fetch stats: ${statsResponse.statusText}`);
        }
        
        let statsData;
        try {
          statsData = await statsResponse.json();
        } catch (error) {
          console.error("Error parsing stats JSON:", error);
          throw new Error("Invalid data received from server");
        }
        
        // Ensure we have the expected data structure to prevent rendering errors
        if (!statsData.stats) {
          statsData.stats = {
            users: {
              total: 0,
              topUsers: [],
              userActivity: []
            },
            content: {
              movies: 0,
              tvShows: 0,
              watchlistEntries: 0,
              platforms: 0
            },
            system: {
              database: {
                connected: false,
                lastChecked: new Date().toISOString()
              },
              sessions: 0
            }
          };
        } else {
          // Ensure sub-objects exist
          if (!statsData.stats.users) {
            statsData.stats.users = { total: 0, topUsers: [], userActivity: [] };
          }
          if (!statsData.stats.content) {
            statsData.stats.content = { movies: 0, tvShows: 0, watchlistEntries: 0, platforms: 0 };
          }
          if (!statsData.stats.system) {
            statsData.stats.system = { 
              database: { connected: false, lastChecked: new Date().toISOString() },
              sessions: 0
            };
          }
          
          // Ensure arrays exist
          if (!statsData.stats.users.topUsers) statsData.stats.users.topUsers = [];
          if (!statsData.stats.users.userActivity) statsData.stats.users.userActivity = [];
        }
        
        setStats(statsData);
        
        // Fetch detailed user activity
        try {
          const activityResponse = await fetch("/api/status/user-activity", {
            headers: setAuthHeader(),
          });
          
          if (activityResponse.ok) {
            const activityData = await activityResponse.json();
            // Ensure expected properties exist
            if (!activityData.recentRegistrations) activityData.recentRegistrations = [];
            if (!activityData.recentActivity) activityData.recentActivity = [];
            setActivityData(activityData);
          }
        } catch (activityError) {
          console.error("Error fetching activity data:", activityError);
          // Continue without activity data - it's not critical
        }
        
      } catch (err) {
        console.error("Error fetching admin data:", err);
        setError(err instanceof Error ? err.message : "Failed to load admin dashboard data");
        toast({
          title: "Error",
          description: "Failed to load admin dashboard data. Please try again.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [toast, setLocation]);

  // Ultra-simple date formatter that handles multiple formats
  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Never";
    if (dateString === "Invalid date") return "Unknown";
    
    try {
      // For debugging - show the raw format in development
      if (process.env.NODE_ENV === 'development') {
        console.log('Date string format:', dateString);
      }
      
      let dateObj: Date;
      
      // Handle PostgreSQL format: 2025-03-11 13:34:16.831175
      if (dateString.includes(' ') && !dateString.includes('T')) {
        const [datePart, timePart] = dateString.split(' ');
        const [year, month, day] = datePart.split('-').map(Number);
        let [hours, minutes, seconds] = [0, 0, 0];
        
        if (timePart) {
          const timeComponents = timePart.split(':');
          hours = parseInt(timeComponents[0] || '0');
          minutes = parseInt(timeComponents[1] || '0');
          // Handle seconds with possible decimal
          if (timeComponents[2]) {
            seconds = parseInt(timeComponents[2].split('.')[0]);
          }
        }
        
        // Create date using UTC to avoid timezone issues
        dateObj = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
      } else {
        // Standard handling for ISO format or already formatted dates
        dateObj = new Date(dateString);
      }
      
      // Verify the date is valid
      if (isNaN(dateObj.getTime())) {
        return String(dateString);
      }
      
      // Format relative to now
      return formatDistance(dateObj, new Date(), { addSuffix: true });
    } catch (err) {
      // If all else fails, just show the string
      return String(dateString);
    }
  };

  // Get status badge color
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "to_watch":
        return <Badge variant="outline">To Watch</Badge>;
      case "watching":
        return <Badge variant="secondary">Watching</Badge>;
      case "watched":
        return <Badge variant="default">Watched</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-6">
        <h1 className="text-3xl font-bold mb-6">Admin Dashboard</h1>
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-4 w-2/3" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-4 w-2/3" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto py-6">
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="container mx-auto py-6">
        <Alert>
          <AlertTitle>No Data</AlertTitle>
          <AlertDescription>No admin data available. You may not have the proper permissions.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          {stats.environment && (
            <div className="mt-1">
              <Badge variant={stats.environment === 'production' ? 'destructive' : 'default'} className="text-sm">
                {stats.environment === 'production' ? 'PRODUCTION' : 'DEVELOPMENT'} ENVIRONMENT
              </Badge>
            </div>
          )}
        </div>
        <div className="flex space-x-2">
          <Button 
            onClick={() => window.location.reload()} 
            variant="outline"
          >
            Refresh Data
          </Button>
          <Button 
            onClick={() => {
              // Force a complete cache bypass by appending a timestamp
              const cacheBuster = `?cache=${Date.now()}`;
              window.location.href = window.location.pathname + cacheBuster;
            }}
            variant="default"
          >
            Force Refresh (Clear Cache)
          </Button>
        </div>
      </div>

      <div className="grid gap-6">
        {/* System Health */}
        <Card>
          <CardHeader>
            <CardTitle>System Health</CardTitle>
            <CardDescription>Overview of system performance and status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Database Status</h3>
                <div className="flex items-center">
                  <div className={`h-2 w-2 rounded-full mr-2 ${stats.stats.system.database.connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <span>{stats.stats.system.database.connected ? 'Connected' : 'Disconnected'}</span>
                </div>
                <p className="text-xs text-gray-500">
                  Last checked: {formatDate(stats.stats.system.database.lastChecked)}
                </p>
              </div>
              
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Active Sessions</h3>
                <p className="text-2xl font-bold">{stats.stats.system.sessions}</p>
              </div>
              
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Last Updated</h3>
                <p>{formatDate(stats.timestamp)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Key Metrics */}
        <div className="grid gap-6 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Users</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.stats.users.total}</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Movies</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.stats.content.movies}</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>TV Shows</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.stats.content.tvShows || 0}</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Watchlist Entries</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.stats.content.watchlistEntries}</div>
              <div className="text-xs text-muted-foreground pt-2">
                Each entry is a user-movie relationship
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Media Type Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Media Type Breakdown</CardTitle>
            <CardDescription>Distribution of unique movies vs TV shows in the catalog</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Movies</span>
                  <span className="font-bold">{stats.stats.content.movies}</span>
                </div>
                <div className="h-2.5 w-full bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-600 rounded-full" 
                    style={{ 
                      width: `${Math.round((stats.stats.content.movies / (stats.stats.content.movies + (stats.stats.content.tvShows || 0))) * 100)}%` 
                    }}
                  ></div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {Math.round((stats.stats.content.movies / (stats.stats.content.movies + (stats.stats.content.tvShows || 0))) * 100)}% of catalog
                </p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">TV Shows</span>
                  <span className="font-bold">{stats.stats.content.tvShows || 0}</span>
                </div>
                <div className="h-2.5 w-full bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-purple-600 rounded-full" 
                    style={{ 
                      width: `${Math.round(((stats.stats.content.tvShows || 0) / (stats.stats.content.movies + (stats.stats.content.tvShows || 0))) * 100)}%` 
                    }}
                  ></div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {Math.round(((stats.stats.content.tvShows || 0) / (stats.stats.content.movies + (stats.stats.content.tvShows || 0))) * 100)}% of catalog
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs for different data views */}
        <Tabs defaultValue="users">
          <TabsList className="mb-4">
            <TabsTrigger value="users">User Activity</TabsTrigger>
            <TabsTrigger value="topUsers">Top Users</TabsTrigger>
            {activityData && (
              <>
                <TabsTrigger value="recent">Recent Activity</TabsTrigger>
                <TabsTrigger value="registrations">New Registrations</TabsTrigger>
              </>
            )}
          </TabsList>
          
          {/* User Activity Tab */}
          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle>User Activity</CardTitle>
                <CardDescription>All users sorted by recent activity</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Username</TableHead>
                        <TableHead>Display Name</TableHead>
                        <TableHead>Watchlist Count</TableHead>
                        <TableHead>Last Activity</TableHead>
                        <TableHead>Registration Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.stats.users.userActivity && stats.stats.users.userActivity.length > 0 ? 
                        stats.stats.users.userActivity.map((user) => (
                          <TableRow key={user.id}>
                            <TableCell>{user.id}</TableCell>
                            <TableCell>
                              {user.username}
                              {user.database_environment && (
                                <Badge 
                                  variant={user.database_environment === 'production' ? 'destructive' : 'default'} 
                                  className="ml-2 text-xs"
                                >
                                  {user.database_environment}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>{user.display_name || '-'}</TableCell>
                            <TableCell>{user.watchlist_count}</TableCell>
                            <TableCell>{formatDate(user.last_activity)}</TableCell>
                            <TableCell>{formatDate(user.last_login)}</TableCell>
                          </TableRow>
                        ))
                      : (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-4">No user activity data available</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* Top Users Tab */}
          <TabsContent value="topUsers">
            <Card>
              <CardHeader>
                <CardTitle>Top Users</CardTitle>
                <CardDescription>Users with the most watchlist entries</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rank</TableHead>
                      <TableHead>Username</TableHead>
                      <TableHead>Display Name</TableHead>
                      <TableHead>Watchlist Entries</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.stats.users.topUsers && stats.stats.users.topUsers.length > 0 ? 
                      stats.stats.users.topUsers.map((user, index) => (
                        <TableRow key={user.id}>
                          <TableCell>#{index + 1}</TableCell>
                          <TableCell>
                            {user.username}
                            {user.database_environment && (
                              <Badge 
                                variant={user.database_environment === 'production' ? 'destructive' : 'default'} 
                                className="ml-2 text-xs"
                              >
                                {user.database_environment}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{user.display_name || '-'}</TableCell>
                          <TableCell>{user.entry_count}</TableCell>
                        </TableRow>
                      ))
                    : (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-4">No watchlist data available</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* Recent Activity Tab */}
          {activityData && (
            <TabsContent value="recent">
              <Card>
                <CardHeader>
                  <CardTitle>Recent Watchlist Activity</CardTitle>
                  <CardDescription>
                    Latest watchlist updates
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead>Movie</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activityData.recentActivity.map((activity, index) => (
                          <TableRow key={index}>
                            <TableCell>
                              {activity.username}
                              {activity.database_environment && (
                                <Badge 
                                  variant={activity.database_environment === 'production' ? 'destructive' : 'default'} 
                                  className="ml-2 text-xs"
                                >
                                  {activity.database_environment}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate">{activity.title}</TableCell>
                            <TableCell>{getStatusBadge(activity.status)}</TableCell>
                            <TableCell>{formatDate(activity.created_at)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>
          )}
          
          {/* New Registrations Tab */}
          {activityData && (
            <TabsContent value="registrations">
              <Card>
                <CardHeader>
                  <CardTitle>Recent Registrations</CardTitle>
                  <CardDescription>
                    {isProductionEnvironment() ? 'Users who joined in the last 7 days' : 'All users in development environment'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Username</TableHead>
                        <TableHead>Display Name</TableHead>
                        <TableHead>Registration Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activityData.recentRegistrations.length > 0 ? (
                        activityData.recentRegistrations.map((registration, index) => (
                          <TableRow key={index}>
                            <TableCell>
                              {registration.username}
                              {registration.database_environment && (
                                <Badge 
                                  variant={registration.database_environment === 'production' ? 'destructive' : 'default'} 
                                  className="ml-2 text-xs"
                                >
                                  {registration.database_environment}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>{registration.display_name || '-'}</TableCell>
                            <TableCell>{formatDate(registration.created_at)}</TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-6">
                            {isProductionEnvironment() ? 'No new registrations in the last 7 days' : 'No user registrations available'}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
};

export default AdminDashboardPage;