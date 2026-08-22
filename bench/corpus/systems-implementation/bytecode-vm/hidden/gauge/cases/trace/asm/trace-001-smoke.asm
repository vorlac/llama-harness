; case trace-001-smoke
; expect exit=0 stdout="hello, svm\n42\n"
.func main arity=0 locals=0
  PUSH_STR "hello, svm"
  PRINT
  PUSH_INT 6
  PUSH_INT 7
  MUL
  PRINT
  RET
.end
