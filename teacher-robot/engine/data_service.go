package engine

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/DARTVADER1-DROID/distributed-ai-teaching-assistant/teacher-robot/models"
)

var (
	ErrCourseNotFound   = errors.New("course not found")
	ErrNoCurrentTopic   = errors.New("no current topic to teach")
	ErrDuplicateContent = errors.New("duplicate topic content")
)

type TeachingProgress struct {
	Course          models.Course
	Topic           models.Topic
	TopicID         string
	Progress        float64
	Completed       bool
	CompletedTopics int
	TotalTopics     int
}

type DataService struct {
	courses            []models.Course
	currentCourseIndex int
	currentTopicIndex  int
	completedTopicIDs  map[string]bool
}

func NewDataService() *DataService {
	return &DataService{
		completedTopicIDs: make(map[string]bool),
	}
}

func (s *DataService) AddCourse(course models.Course) (models.Course, error) {
	if err := validateCourse(course); err != nil {
		return models.Course{}, err
	}

	course.ID, err = generateID("course")
	if err != nil {
		return models.Course{}, err
	}
	if err := assignTopicIDs(&course); err != nil {
		return models.Course{}, err
	}
	if err := validateUniqueContent(course); err != nil {
		return models.Course{}, err
	}

	s.courses = append(s.courses, cloneCourse(course))
	return cloneCourse(course), nil
}

func (s *DataService) UpdateCourse(courseID string, replacement models.Course) (models.Course, error) {
	index := s.findCourseIndex(courseID)
	if index == -1 {
		return models.Course{}, ErrCourseNotFound
	}
	if err := validateCourse(replacement); err != nil {
		return models.Course{}, err
	}

	replacement.ID = courseID
	if err := assignTopicIDs(&replacement); err != nil {
		return models.Course{}, err
	}
	if err := validateUniqueContent(replacement); err != nil {
		return models.Course{}, err
	}

	// Replacing a course invalidates its old topic identities. If it is at
	// or before the current position, restart teaching from that course.
	if index <= s.currentCourseIndex {
		for _, topic := range s.courses[index].Topics {
			delete(s.completedTopicIDs, topic.ID)
		}
		for i := index + 1; i < len(s.courses); i++ {
			for _, topic := range s.courses[i].Topics {
				delete(s.completedTopicIDs, topic.ID)
			}
		}
		s.currentCourseIndex = index
		s.currentTopicIndex = 0
	}

	s.courses[index] = cloneCourse(replacement)
	return cloneCourse(replacement), nil
}

func (s *DataService) ShowAllCourses() []models.Course {
	courses := make([]models.Course, len(s.courses))
	for i, course := range s.courses {
		courses[i] = cloneCourse(course)
	}
	return courses
}

func (s *DataService) DeleteAllCourses() {
	s.courses = nil
	s.currentCourseIndex = 0
	s.currentTopicIndex = 0
	s.completedTopicIDs = make(map[string]bool)
}

func (s *DataService) GetCurrentProgress() (TeachingProgress, error) {
	if len(s.courses) == 0 {
		return TeachingProgress{}, ErrNoCurrentTopic
	}
	if s.currentCourseIndex >= len(s.courses) {
		return s.completedProgress(), nil
	}

	course := s.courses[s.currentCourseIndex]
	if s.currentTopicIndex >= len(course.Topics) {
		return TeachingProgress{}, ErrNoCurrentTopic
	}

	topic := course.Topics[s.currentTopicIndex]
	return s.progressFor(course, topic), nil
}

func (s *DataService) CompleteCurrent() (TeachingProgress, error) {
	if s.currentCourseIndex >= len(s.courses) {
		return TeachingProgress{}, ErrNoCurrentTopic
	}

	course := s.courses[s.currentCourseIndex]
	if s.currentTopicIndex >= len(course.Topics) {
		return TeachingProgress{}, ErrNoCurrentTopic
	}

	currentTopic := course.Topics[s.currentTopicIndex]
	s.completedTopicIDs[currentTopic.ID] = true
	s.currentTopicIndex++

	if s.currentTopicIndex >= len(course.Topics) {
		s.currentCourseIndex++
		s.currentTopicIndex = 0
	}

	if s.currentCourseIndex >= len(s.courses) {
		return s.completedProgress(), nil
	}

	nextCourse := s.courses[s.currentCourseIndex]
	return s.progressFor(nextCourse, nextCourse.Topics[s.currentTopicIndex]), nil
}

func (s *DataService) progressFor(course models.Course, topic models.Topic) TeachingProgress {
	completed, total := s.topicCounts()
	progress := 0.0
	if total > 0 {
		progress = float64(completed) / float64(total) * 100
	}

	return TeachingProgress{
		Course:          cloneCourse(course),
		Topic:           cloneTopic(topic),
		TopicID:         topic.ID,
		Progress:        progress,
		CompletedTopics: completed,
		TotalTopics:     total,
	}
}

func (s *DataService) completedProgress() TeachingProgress {
	completed, total := s.topicCounts()
	progress := 0.0
	if total > 0 {
		progress = 100
	}
	return TeachingProgress{
		Progress:        progress,
		Completed:       total > 0,
		CompletedTopics: completed,
		TotalTopics:     total,
	}
}

func (s *DataService) topicCounts() (completed, total int) {
	for _, course := range s.courses {
		total += len(course.Topics)
		for _, topic := range course.Topics {
			if s.completedTopicIDs[topic.ID] {
				completed++
			}
		}
	}
	return completed, total
}

func (s *DataService) findCourseIndex(courseID string) int {
	for i, course := range s.courses {
		if course.ID == courseID {
			return i
		}
	}
	return -1
}

func validateCourse(course models.Course) error {
	if strings.TrimSpace(course.Name) == "" {
		return errors.New("course name is required")
	}
	if len(course.Topics) == 0 {
		return errors.New("course must contain at least one topic")
	}

	for i, topic := range course.Topics {
		if strings.TrimSpace(topic.Name) == "" {
			return fmt.Errorf("topic %d: name is required", i+1)
		}
		if len(topic.Content.Paragraphs) == 0 {
			return fmt.Errorf("topic %q: at least one paragraph is required", topic.Name)
		}
		for j, paragraph := range topic.Content.Paragraphs {
			if strings.TrimSpace(paragraph) == "" {
				return fmt.Errorf("topic %q: paragraph %d is empty", topic.Name, j+1)
			}
		}
	}
	return nil
}

func validateUniqueContent(course models.Course) error {
	seen := make(map[string]string)
	for _, topic := range course.Topics {
		key := contentKey(topic.Content)
		if previousTopic, exists := seen[key]; exists {
			return fmt.Errorf("%w: topics %q and %q contain identical paragraphs", ErrDuplicateContent, previousTopic, topic.Name)
		}
		seen[key] = topic.Name
	}
	return nil
}

func contentKey(content models.Content) string {
	paragraphs := make([]string, len(content.Paragraphs))
	for i, paragraph := range content.Paragraphs {
		paragraphs[i] = strings.TrimSpace(paragraph)
	}
	return strings.Join(paragraphs, "\x00")
}

func assignTopicIDs(course *models.Course) error {
	for i := range course.Topics {
		id, err := generateID("topic")
		if err != nil {
			return err
		}
		course.Topics[i].ID = id
	}
	return nil
}

func cloneCourse(course models.Course) models.Course {
	clone := course
	clone.Topics = make([]models.Topic, len(course.Topics))
	for i, topic := range course.Topics {
		clone.Topics[i] = cloneTopic(topic)
	}
	return clone
}

func cloneTopic(topic models.Topic) models.Topic {
	clone := topic
	clone.Content.Paragraphs = append([]string(nil), topic.Content.Paragraphs...)
	return clone
}

func generateID(prefix string) (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return prefix + "_" + hex.EncodeToString(bytes), nil
}
