; case compare-124-gtstr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  PUSH_STR "a"
  GT
  PRINT
  RET
.end
