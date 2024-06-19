# Use the official Python 2.7.14 image from Docker Hub
FROM python:2.7.14

# Set the working directory inside the container
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY . /app

# Expose port 8889 to the outside world
EXPOSE 8889

# Run Server8889.py when the container launches
CMD ["python", "Server8889.py"]