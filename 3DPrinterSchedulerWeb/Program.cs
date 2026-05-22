using _3DPrinterSchedulerWeb.Data;
using _3DPrinterSchedulerWeb.Hubs;
using Microsoft.EntityFrameworkCore;

namespace _3DPrinterSchedulerWeb
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);

            // Add services to the container.
            builder.Services.AddRazorPages()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
    });
            builder.Services.AddSignalR();
            builder.Services.AddDistributedMemoryCache();
            builder.Services.AddSession(options =>
            {
                options.Cookie.HttpOnly = true;
                options.Cookie.IsEssential = true;
                options.IdleTimeout = TimeSpan.FromHours(8);
            });

            builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite("Data Source=scheduler.db"));

            var app = builder.Build();

            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.Database.EnsureCreated();
                db.Database.ExecuteSqlRaw(@"CREATE TABLE IF NOT EXISTS Printers (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    Name TEXT NOT NULL DEFAULT '',
                    SortOrder INTEGER NOT NULL DEFAULT 0
                )");
                try { db.Database.ExecuteSqlRaw("ALTER TABLE Filaments ADD COLUMN SortOrder INTEGER NOT NULL DEFAULT 0"); } catch { }
                try { db.Database.ExecuteSqlRaw("ALTER TABLE ClassGroups ADD COLUMN SortOrder INTEGER NOT NULL DEFAULT 0"); } catch { }
                db.Database.ExecuteSqlRaw(@"CREATE TABLE IF NOT EXISTS AdminUsers (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    Username TEXT NOT NULL DEFAULT ''
                )");
                db.Database.ExecuteSqlRaw(@"CREATE TABLE IF NOT EXISTS AppSettings (
                    Key TEXT PRIMARY KEY NOT NULL,
                    Value TEXT NOT NULL DEFAULT ''
                )");
            }

            // Configure the HTTP request pipeline.
            if (!app.Environment.IsDevelopment())
            {
                app.UseExceptionHandler("/Error");
                // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
                app.UseHsts();
            }

            app.UseHttpsRedirection();

            app.UseRouting();

            app.UseSession();
            app.UseAuthorization();

            app.MapStaticAssets();
            app.MapRazorPages()
               .WithStaticAssets();
            app.MapHub<SchedulerHub>("/schedulerHub");

            app.Run();
        }
    }
}
