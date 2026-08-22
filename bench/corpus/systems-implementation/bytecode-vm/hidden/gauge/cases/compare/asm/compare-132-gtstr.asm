; case compare-132-gtstr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "hello"
  PUSH_STR "hello"
  GT
  PRINT
  RET
.end
